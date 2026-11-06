"""Build real-world terrain packages for Nationforge.

    python -I tools/build_terrain.py            # all locations
    python -I tools/build_terrain.py shuna      # one location

Downloads are cached in data-raw/<id>/ (delete a file to refetch). Output in public/data/<id>/:
  terrain.bin  int16 little-endian, real metres * 4 (land elevation, negative = sea depth), row 0 = north
  mask.bin     uint8 flags per cell, see MASK_* below
  meta.json    grid size, scales, sources, statistics, approximations, OSM vectors in grid units
  preview.png  quick-look image (not used by the game)

Sources
  Land:        Copernicus GLO-30 DEM (AWS open data, s3://copernicus-dem-30m)
  Bathymetry:  EMODnet Bathymetry DTM (Europe) or AWS Terrain Tiles / terrarium (ETOPO1/GEBCO-derived), blended
               near the coast with a clearly labelled shelf approximation
  Coastline, roads, places, buildings, protected areas, land cover: OpenStreetMap via Overpass (ODbL)
"""
import io
import json
import math
import os
import sys
import time
import urllib.parse
import urllib.request

import numpy as np
import tifffile
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "data-raw")
OUT = os.path.join(ROOT, "public", "data")
LOC = json.load(open(os.path.join(ROOT, "tools", "locations.json"), encoding="utf-8"))

OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter",
            "https://lz4.overpass-api.de/api/interpreter"]
TOOL_UA = "nationforge-build/1.0 (terrain packager)"
COP = "https://copernicus-dem-30m.s3.amazonaws.com/{n}/{n}.tif"
EMOD = "https://ows.emodnet-bathymetry.eu/wcs"
TERRARIUM = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"

MASK_SEA, MASK_FOREIGN, MASK_TERRITORY = 0, 1, 2   # bits 0-1
MASK_PROTECTED = 4
MASK_FOREST = 8
MASK_REEF = 16
MASK_BEACH = 32
MASK_COMMUNITY = 64
MASK_APPROX = 128


def log(*a):
    print(*[str(x).encode("ascii", "replace").decode() for x in a], flush=True)


def fetch(url, path, data=None, ua=TOOL_UA, allow_404=False):
    if os.path.exists(path) and os.path.getsize(path) > 200:
        return True
    urls = url if isinstance(url, list) else [url]
    last = None
    for attempt in range(7):
        try:
            req = urllib.request.Request(urls[attempt % len(urls)], data=data, headers={"User-Agent": ua})
            with urllib.request.urlopen(req, timeout=300) as r:
                body = r.read()
            with open(path + ".part", "wb") as f:
                f.write(body)
            os.replace(path + ".part", path)
            return True
        except urllib.error.HTTPError as e:
            if allow_404 and e.code in (403, 404):
                return False
            last = e
        except Exception as e:  # noqa: BLE001
            last = e
        log("  retry", attempt + 1, last)
        time.sleep(4 * (attempt + 1))
    raise last


def overpass(query, path):
    fetch(OVERPASS, path, data=urllib.parse.urlencode({"data": query}).encode())
    return json.load(open(path, encoding="utf-8"))["elements"]


class Proj:
    """Local equirectangular projection: x metres east, y metres north of the origin."""

    def __init__(self, lat0, lon0):
        p = math.radians(lat0)
        self.lat0, self.lon0 = lat0, lon0
        self.m_lat = 111132.92 - 559.82 * math.cos(2 * p) + 1.175 * math.cos(4 * p)
        self.m_lon = 111412.84 * math.cos(p) - 93.5 * math.cos(3 * p)


class GridDef:
    def __init__(self, proj, x0, y1, cell, w, h):
        self.p, self.x0, self.y1, self.cell, self.w, self.h = proj, x0, y1, cell, w, h

    def latlon_grid(self):
        xs = self.x0 + (np.arange(self.w) + 0.5) * self.cell
        ys = self.y1 - (np.arange(self.h) + 0.5) * self.cell
        lon = self.p.lon0 + xs / self.p.m_lon
        lat = self.p.lat0 + ys / self.p.m_lat
        return np.meshgrid(lat, lon, indexing="ij")

    def to_grid(self, lat, lon):
        x = (lon - self.p.lon0) * self.p.m_lon
        y = (lat - self.p.lat0) * self.p.m_lat
        return (x - self.x0) / self.cell, (self.y1 - y) / self.cell

    def bbox(self):
        lon0 = self.p.lon0 + self.x0 / self.p.m_lon
        lon1 = self.p.lon0 + (self.x0 + self.w * self.cell) / self.p.m_lon
        lat1 = self.p.lat0 + self.y1 / self.p.m_lat
        lat0 = self.p.lat0 + (self.y1 - self.h * self.cell) / self.p.m_lat
        return lon0, lat0, lon1, lat1


def bilinear(arr, fx, fy):
    """Sample arr at fractional pixel-centre coordinates; out-of-range clamps to the edge."""
    h, w = arr.shape
    fx = np.clip(fx, 0, w - 1.001)
    fy = np.clip(fy, 0, h - 1.001)
    i = np.floor(fx).astype(int)
    j = np.floor(fy).astype(int)
    tx, ty = fx - i, fy - j
    return (arr[j, i] * (1 - tx) * (1 - ty) + arr[j, i + 1] * tx * (1 - ty)
            + arr[j + 1, i] * (1 - tx) * ty + arr[j + 1, i + 1] * tx * ty)


# ---------------------------------------------------------------- land DEM

def cop_name(lat, lon):
    ns = ("N%02d" % lat) if lat >= 0 else ("S%02d" % -lat)
    ew = ("E%03d" % lon) if lon >= 0 else ("W%03d" % -lon)
    return f"Copernicus_DSM_COG_10_{ns}_00_{ew}_00_DEM"


def copernicus(g, raw, lat, lon):
    lon0, lat0, lon1, lat1 = g.bbox()
    out = np.full(lat.shape, np.nan, dtype=np.float64)
    tiles = []
    for tl in range(math.floor(lat0), math.floor(lat1) + 1):
        for tn in range(math.floor(lon0), math.floor(lon1) + 1):
            name = cop_name(tl, tn)
            path = os.path.join(raw, name + ".tif")
            log("  DEM tile", name)
            if not fetch(COP.format(n=name), path, allow_404=True):
                log("  (no tile: open ocean)")
                continue
            tiles.append(name)
            with tifffile.TiffFile(path) as tf:
                page = tf.pages[0]
                a = page.asarray().astype(np.float64)
                tie = page.tags["ModelTiepointTag"].value
                sc = page.tags["ModelPixelScaleTag"].value
                geo = tf.geotiff_metadata or {}
            is_point = str(geo.get("GTRasterTypeGeoKey", "")).endswith("Point") or geo.get("GTRasterTypeGeoKey") == 2
            ox, oy = tie[3], tie[4]
            if not is_point:   # tie point is the corner of pixel (0,0); move to its centre
                ox += sc[0] / 2
                oy -= sc[1] / 2
            a[(a < -1000) | ~np.isfinite(a)] = np.nan
            fx = (lon - ox) / sc[0]
            fy = (oy - lat) / sc[1]
            inside = (fx >= 0) & (fx <= a.shape[1] - 1) & (fy >= 0) & (fy <= a.shape[0] - 1)
            if inside.any():
                out[inside] = bilinear(a, fx[inside], fy[inside])
    return out, tiles


# ---------------------------------------------------------------- bathymetry

def emodnet(g, raw, lat, lon):
    lon0, lat0, lon1, lat1 = g.bbox()
    res = 1.0 / 16 / 60   # native 1/16 arc-minute
    w = max(8, round((lon1 - lon0) / res))
    h = max(8, round((lat1 - lat0) / res))
    q = dict(service="WCS", version="1.0.0", request="GetCoverage", coverage="emodnet:mean", crs="EPSG:4326",
             bbox=f"{lon0:.6f},{lat0:.6f},{lon1:.6f},{lat1:.6f}", format="image/tiff", width=w, height=h)
    path = os.path.join(raw, "emodnet.tif")
    fetch(EMOD + "?" + urllib.parse.urlencode(q), path)
    a = tifffile.imread(path).astype(np.float64)
    a[(a < -12000) | (a > 9000) | ~np.isfinite(a)] = np.nan
    fx = (lon - lon0) / (lon1 - lon0) * w - 0.5
    fy = (lat1 - lat) / (lat1 - lat0) * h - 0.5
    return bilinear(np.nan_to_num(a, nan=0.0), fx, fy), dict(
        name="EMODnet Bathymetry Digital Terrain Model (mean depth)", resolution_m=round(res * g.p.m_lat),
        licence="CC BY 4.0", attribution="EMODnet Bathymetry Consortium (2022/2024): EMODnet Digital Bathymetry (DTM)",
        url="https://emodnet.ec.europa.eu/en/bathymetry")


def terrarium(g, raw, lat, lon, z=11):
    lon0, lat0, lon1, lat1 = g.bbox()

    def tile_xy(la, lo):
        n = 2 ** z
        x = (np.asarray(lo, dtype=np.float64) + 180) / 360 * n
        y = (1 - np.arcsinh(np.tan(np.radians(np.asarray(la, dtype=np.float64)))) / math.pi) / 2 * n
        return x, y

    xa, ya = tile_xy(lat1, lon0)
    xb, yb = tile_xy(lat0, lon1)
    tx0, ty0, tx1, ty1 = int(float(xa)), int(float(ya)), int(float(xb)), int(float(yb))
    mosaic = np.zeros(((ty1 - ty0 + 1) * 256, (tx1 - tx0 + 1) * 256))
    for ty in range(ty0, ty1 + 1):
        for tx in range(tx0, tx1 + 1):
            path = os.path.join(raw, f"terrarium_{z}_{tx}_{ty}.png")
            fetch(TERRARIUM.format(z=z, x=tx, y=ty), path)
            im = np.asarray(Image.open(path).convert("RGB"), dtype=np.float64)
            hgt = im[..., 0] * 256 + im[..., 1] + im[..., 2] / 256 - 32768
            mosaic[(ty - ty0) * 256:(ty - ty0 + 1) * 256, (tx - tx0) * 256:(tx - tx0 + 1) * 256] = hgt
    px, py = tile_xy(lat, lon)
    fx = (px - tx0) * 256 - 0.5
    fy = (py - ty0) * 256 - 0.5
    return bilinear(mosaic, fx, fy), dict(
        name="AWS Terrain Tiles (terrarium), ocean from ETOPO1 / GEBCO", resolution_m=1800,
        licence="Open data; ETOPO1 public domain (NOAA), GEBCO grid public domain with attribution",
        attribution="Terrain Tiles by Mapzen/Linux Foundation on AWS Open Data; ETOPO1 (NOAA NCEI); GEBCO Compilation Group",
        url="https://registry.opendata.aws/terrain-tiles/")


# ---------------------------------------------------------------- vector helpers

def chain(ways):
    """Join coordinate lists that share endpoints. Returns (closed_rings, open_chains)."""
    key = lambda p: (round(p[0], 7), round(p[1], 7))  # noqa: E731
    pending = [list(w) for w in ways if len(w) >= 2]
    rings, chains = [], []
    while pending:
        cur = pending.pop()
        grew = True
        while grew and key(cur[0]) != key(cur[-1]):
            grew = False
            for i, w in enumerate(pending):
                if key(w[0]) == key(cur[-1]):
                    cur += w[1:]
                elif key(w[-1]) == key(cur[-1]):
                    cur += w[::-1][1:]
                elif key(w[-1]) == key(cur[0]):
                    cur = w[:-1] + cur
                elif key(w[0]) == key(cur[0]):
                    cur = w[::-1][:-1] + cur
                else:
                    continue
                pending.pop(i)
                grew = True
                break
        (rings if key(cur[0]) == key(cur[-1]) and len(cur) > 3 else chains).append(cur)
    return rings, chains


def geom_of(el):
    return [(p["lat"], p["lon"]) for p in el.get("geometry", []) if p]


def area_ways(el):
    """Outer-ring coordinate lists for a closed way or multipolygon relation."""
    if el["type"] == "way":
        return [geom_of(el)]
    outers = [geom_of(m) for m in el.get("members", []) if m.get("role") in ("outer", "") and m.get("geometry")]
    rings, _ = chain(outers)
    return rings


def raster(g, rings, ss=3):
    img = Image.new("L", (g.w * ss, g.h * ss), 0)
    dr = ImageDraw.Draw(img)
    for r in rings:
        pts = []
        for la, lo in r:
            fx, fy = g.to_grid(la, lo)
            pts.append((fx * ss, fy * ss))
        if len(pts) >= 3:
            dr.polygon(pts, fill=255)
    small = img.resize((g.w, g.h), Image.BOX)
    return np.asarray(small, dtype=np.float64) / 255.0


def ring_area(g, r):
    pts = [g.to_grid(la, lo) for la, lo in r]
    s = 0.0
    for (x1, y1), (x2, y2) in zip(pts, pts[1:] + pts[:1]):
        s += x1 * y2 - x2 * y1
    return abs(s) / 2 * g.cell * g.cell


def distance_cells(src, max_steps=400):
    """Approximate Euclidean distance (cells) from the True cells of src, by 8-neighbour brushfire."""
    d = np.where(src, 0.0, np.inf)
    for _ in range(max_steps):
        p = np.pad(d, 1, constant_values=np.inf)
        n = np.minimum.reduce([
            p[:-2, 1:-1] + 1, p[2:, 1:-1] + 1, p[1:-1, :-2] + 1, p[1:-1, 2:] + 1,
            p[:-2, :-2] + 1.4142, p[:-2, 2:] + 1.4142, p[2:, :-2] + 1.4142, p[2:, 2:] + 1.4142, d])
        if np.array_equal(n, d):
            break
        d = n
    return d


def simplify(pts, tol):
    if len(pts) < 3:
        return pts
    a, b = np.array(pts[0]), np.array(pts[-1])
    ab = b - a
    L = np.hypot(*ab)
    best, idx = -1.0, 0
    for i in range(1, len(pts) - 1):
        p = np.array(pts[i])
        d = abs(ab[0] * (a[1] - p[1]) - ab[1] * (a[0] - p[0])) / L if L > 1e-9 else np.hypot(*(p - a))
        if d > best:
            best, idx = d, i
    if best > tol:
        return simplify(pts[:idx + 1], tol)[:-1] + simplify(pts[idx:], tol)
    return [pts[0], pts[-1]]


# ---------------------------------------------------------------- build

def build(lid):
    cfg = LOC[lid]
    raw = os.path.join(RAW, lid)
    out = os.path.join(OUT, lid)
    os.makedirs(raw, exist_ok=True)
    os.makedirs(out, exist_ok=True)
    log(f"== {lid}: {cfg['name']}")

    # Island outline from OSM
    kind, oid = cfg["osm"]
    island = overpass(f"[out:json][timeout:120];{kind}({oid});out geom;", os.path.join(raw, "island.json"))[0]
    island_rings = area_ways(island)
    allpts = [p for r in island_rings for p in r]
    la_min, la_max = min(p[0] for p in allpts), max(p[0] for p in allpts)
    lo_min, lo_max = min(p[1] for p in allpts), max(p[1] for p in allpts)
    proj = Proj((la_min + la_max) / 2, (lo_min + lo_max) / 2)
    ex = (lo_max - lo_min) * proj.m_lon / 2 + cfg["margin_m"]
    ey = (la_max - la_min) * proj.m_lat / 2 + cfg["margin_m"]
    cell = 2 * max(ex, ey) / cfg["grid"]
    w, h = math.ceil(2 * ex / cell), math.ceil(2 * ey / cell)
    g = GridDef(proj, -w * cell / 2, h * cell / 2, cell, w, h)
    lon0, lat0, lon1, lat1 = g.bbox()
    log(f"  grid {w}x{h}, cell {cell:.1f} m real, bbox {lon0:.4f},{lat0:.4f},{lon1:.4f},{lat1:.4f}")
    lat, lon = g.latlon_grid()

    # OSM layers
    b = f"({lat0},{lon0},{lat1},{lon1})"
    q = f"""[out:json][timeout:180];(
way["natural"="coastline"]{b};
way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|service|track|living_street)$"]{b};
node["place"]{b};
way["boundary"="protected_area"]{b}; relation["boundary"="protected_area"]{b};
way["leisure"="nature_reserve"]{b}; relation["leisure"="nature_reserve"]{b};
way["natural"~"^(wood|beach|wetland|scrub|heath|grassland|water)$"]{b}; relation["natural"~"^(wood|beach|wetland|water)$"]{b};
way["landuse"~"^(forest|farmland|meadow|orchard|vineyard|residential)$"]{b};
node["man_made"="lighthouse"]{b}; node["historic"]{b}; way["historic"]{b};
node["natural"~"^(peak|bay|cape|beach)$"]{b};
way["man_made"~"^(pier|breakwater|quay)$"]{b};
);out geom;"""
    els = overpass(q, os.path.join(raw, "osm.json"))
    bld = overpass(f'[out:json][timeout:180];(way["building"]{b};);out center;', os.path.join(raw, "buildings.json"))
    log(f"  OSM: {len(els)} features, {len(bld)} buildings")
    tags = lambda e: e.get("tags", {})  # noqa: E731

    # Land / sea from OSM coastline; open chains (mainland) fall back to the DEM
    coast = [geom_of(e) for e in els if e["type"] == "way" and tags(e).get("natural") == "coastline"]
    rings, open_chains = chain(coast)
    ringfill = raster(g, rings) >= 0.5 if rings else np.zeros((h, w), bool)
    cop, tiles = copernicus(g, raw, lat, lon)
    missing = ~np.isfinite(cop)
    copz = np.nan_to_num(cop, nan=0.0)
    if open_chains:
        near_ring = distance_cells(ringfill, max_steps=int(200 / cell) + 2) * cell < 150
        land = ringfill | ((copz > 1.0) & ~near_ring)
    else:
        land = ringfill
    # Territory: the island itself plus small islets close to it
    terr = raster(g, island_rings) >= 0.5
    t_area = sum(ring_area(g, r) for r in island_rings)
    dist_terr = distance_cells(terr, max_steps=int(1000 / cell) + 2) * cell
    islets = []
    for r in rings:
        fx, fy = g.to_grid(*np.mean(np.array(r), axis=0))
        if 0 <= fx < w and 0 <= fy < h and not terr[int(fy), int(fx)] and dist_terr[int(fy), int(fx)] < 900 \
                and ring_area(g, r) < 0.15 * t_area:
            islets.append(r)
    if islets:
        terr |= raster(g, islets) >= 0.5
    terr &= land | terr
    land |= terr

    # Land elevation: DEM where it is land; coastal cells the DEM puts at/below sea level get a small positive height
    elev = copz.copy()
    approx = np.zeros((h, w), bool)
    low = land & (elev < 0.6)
    elev[low] = 0.6 + 0.4 * np.clip(elev[low], 0, 1)
    approx |= low | (land & missing)

    # Sea depth: real bathymetry blended with a shelf approximation near the coast
    dist_land = distance_cells(land, max_steps=int(4000 / cell) + 2) * cell
    sh = cfg["shelf"]
    shelf = -(1.0 + sh["slope"] * dist_land)
    if "reef_m" in sh:   # fringing-reef lagoon: shallow lagoon, reef crest, then a steep outer slope
        r_m = sh["reef_m"]
        lagoon = -np.minimum(1.0 + sh["slope"] * dist_land * 1.0, sh["max"])
        crest = (dist_land > r_m - 120) & (dist_land < r_m + 40)
        outer = -(1.5 + sh["dropoff"] * np.maximum(dist_land - r_m, 0))
        shelf = np.where(dist_land < r_m - 120, lagoon, np.where(crest, -0.7, outer))
        shelf = np.maximum(shelf, -sh["deep"])
    else:
        shelf = np.maximum(shelf, -sh["max"])
    bay = np.zeros((h, w), bool)
    if sh.get("bays"):   # deep drowned valleys (e.g. Cook's and Opunohu bays): sea enclosed by land on most sides
        hits = np.zeros((h, w), np.int32)
        steps = int(sh["bays"] / cell)
        for k in range(16):
            ang = k * math.pi / 8
            dx, dy = math.cos(ang), math.sin(ang)
            hit = np.zeros((h, w), bool)
            for st in range(1, steps + 1):
                ox, oy = int(round(dx * st)), int(round(dy * st))
                sh_land = np.zeros((h, w), bool)
                ys0, ys1 = max(0, -oy), min(h, h - oy)
                xs0, xs1 = max(0, -ox), min(w, w - ox)
                sh_land[ys0:ys1, xs0:xs1] = land[ys0 + oy:ys1 + oy, xs0 + ox:xs1 + ox]
                hit |= sh_land
            hits += hit
        bay = ~land & (hits >= 11) & (dist_land > cell * 0.6)
        shelf = np.where(bay, -np.minimum(2.0 + 0.12 * dist_land, 45.0), shelf)
    if cfg["bathy"] == "emodnet":
        bat, bmeta = emodnet(g, raw, lat, lon)
        good = bat < -1.5
        near = dist_land < 2 * cell
        depth = np.where(good, bat, shelf)
        depth = np.where(near, np.maximum(depth, shelf * 0.5 + depth * 0.5), depth)
        approx_sea = ~land & (~good | near)
        method = ("EMODnet DTM where it reports water deeper than 1.5 m; cells within two grid cells of the OSM "
                  "coastline, or where the 115 m DTM reports land, use a linear shelf approximation "
                  f"(1 m + {sh['slope']:.3f} x distance, capped at {sh['max']} m)")
    else:
        bat, bmeta = terrarium(g, raw, lat, lon)
        wgt = np.clip((dist_land - 600) / 2500, 0, 1)
        if "reef_m" in sh:
            wgt = np.clip((dist_land - sh["reef_m"] - 600) / 2500, 0, 1)
        real = np.minimum(bat, -2.0)
        depth = (1 - wgt) * shelf + wgt * np.minimum(real, shelf if "reef_m" not in sh else real)
        approx_sea = ~land & (wgt < 0.999)
        method = ("Coarse ETOPO1/GEBCO-derived ocean depths (about 1.8 km) far offshore; within about 3 km of the OSM "
                  "coastline a modelled profile is blended in" + (
                      f": lagoon 1-{sh['max']} m deep to ~{sh['reef_m']} m offshore, reef crest at ~0.7 m, then an outer "
                      f"slope of {sh['dropoff']:.2f} m/m. Bays inside the reef are NOT individually surveyed."
                      if "reef_m" in sh else f": 1 m + {sh['slope']:.3f} x distance, capped at {sh['max']} m")
                  + (" Enclosed bays (sea surrounded by land on at least 11 of 16 bearings) are modelled as deep drowned "
                     "valleys: 2 m + 0.12 x distance from shore, to 45 m, and carry no reef." if sh.get("bays") else ""))
    depth = np.minimum(depth, -0.5)
    height = np.where(land, elev, depth)
    approx |= approx_sea

    # Flags
    mask = np.where(terr, MASK_TERRITORY, np.where(land, MASK_FOREIGN, MASK_SEA)).astype(np.uint8)

    def polys(pred):
        rs = []
        for e in els:
            if e["type"] in ("way", "relation") and pred(tags(e)):
                rs += [r for r in area_ways(e) if len(r) >= 3]
        return rs

    prot = polys(lambda t: t.get("boundary") == "protected_area" or t.get("leisure") == "nature_reserve")
    if prot:
        mask[raster(g, prot) >= 0.5] |= MASK_PROTECTED
    wood = polys(lambda t: t.get("natural") in ("wood", "scrub", "heath") or t.get("landuse") == "forest")
    if wood:
        mask[(raster(g, wood) >= 0.5) & land] |= MASK_FOREST
    beach = polys(lambda t: t.get("natural") == "beach")
    if beach:
        mask[raster(g, beach) >= 0.3] |= MASK_BEACH
    if "reef_m" in sh:
        mask[~land & ~bay & (dist_land < sh["reef_m"] + 80)] |= MASK_REEF
    else:
        mask[~land & (height > -6) & (dist_land < 400)] |= MASK_REEF   # shallow, ecologically sensitive nearshore water
    centres = [(e["center"]["lat"], e["center"]["lon"]) for e in bld if e.get("center")]
    if cfg.get("community", lid == "moorea") and centres:
        occ = np.zeros((h, w), bool)
        for la, lo in centres:
            fx, fy = g.to_grid(la, lo)
            if 0 <= fx < w and 0 <= fy < h:
                occ[int(fy), int(fx)] = True
        near_b = distance_cells(occ, max_steps=int(260 / cell) + 2) * cell < 250
        mask[near_b & terr] |= MASK_COMMUNITY
    mask[approx] |= MASK_APPROX

    # Vector layers in grid units
    def gpt(la, lo):
        fx, fy = g.to_grid(la, lo)
        return [round(fx, 2), round(fy, 2)]

    def in_terr(p):
        x, y = int(p[0]), int(p[1])
        return 0 <= x < w and 0 <= y < h and (terr[y, x] or dist_terr[y, x] < 2 * cell)

    roads = []
    for e in els:
        hw = tags(e).get("highway")
        if e["type"] == "way" and hw:
            pts = [gpt(la, lo) for la, lo in geom_of(e)]
            cur = []
            for p in pts + [None]:
                if p is not None and in_terr(p):
                    cur.append(p)
                else:
                    if len(cur) >= 2:
                        roads.append({"cls": hw, "name": tags(e).get("name"), "pts": simplify(cur, 0.6)})
                    cur = []
    places = []
    for e in els:
        t = tags(e)
        if e["type"] == "node" and t.get("name") and (t.get("place") or t.get("natural") in ("peak", "bay", "cape", "beach")
                                                      or t.get("man_made") == "lighthouse" or t.get("historic")):
            p = gpt(e["lat"], e["lon"])
            if 0 <= p[0] < w and 0 <= p[1] < h:
                kind = t.get("place") or t.get("natural") or ("lighthouse" if t.get("man_made") else "historic")
                places.append({"name": t.get("name:en") or t["name"], "local": t["name"], "kind": kind, "p": p,
                               "ele": float(t["ele"]) if t.get("ele", "").replace(".", "", 1).isdigit() else None})
    pois = []
    for e in els:
        t = tags(e)
        if e["type"] == "way" and (t.get("historic") or t.get("man_made") in ("pier", "breakwater", "quay")):
            gg = geom_of(e)
            if gg:
                c = np.mean(np.array(gg), axis=0)
                p = gpt(c[0], c[1])
                if 0 <= p[0] < w and 0 <= p[1] < h:
                    pois.append({"kind": t.get("historic") or t.get("man_made"), "name": t.get("name"), "p": p})
    bl = [gpt(la, lo) for la, lo in centres]
    bl = [p for p in bl if in_terr(p)]
    if len(bl) > 1600:
        bl = bl[:: math.ceil(len(bl) / 1600)]
    outline = []
    for r in island_rings + islets:
        pts = simplify([gpt(la, lo) for la, lo in r], 0.8)
        if len(pts) >= 4:
            outline.append(pts)

    # Statistics and metadata
    hs, vs = cfg["hscale"], cfg["vscale"]
    land_elev = height[land]
    terr_slope = slope_deg(height, cell)[terr]
    meta = {
        "id": lid, "name": cfg["name"], "country": cfg["country"], "format": 1,
        "width": w, "height": h, "cellReal": round(cell, 3), "hscale": hs, "vscale": vs,
        "verticalExaggeration": round(vs / hs, 3),
        "center": [round(proj.lat0, 6), round(proj.lon0, 6)], "bbox": [round(v, 6) for v in g.bbox()],
        "encoding": {"terrain": "int16 LE, real metres x 4, row 0 north", "mask": "uint8 flags"},
        "maskBits": {"classMask": 3, "sea": 0, "foreign": 1, "territory": 2, "protected": MASK_PROTECTED,
                     "forest": MASK_FOREST, "reef": MASK_REEF, "beach": MASK_BEACH, "community": MASK_COMMUNITY,
                     "approx": MASK_APPROX},
        "stats": {
            "maxElevation": round(float(land_elev.max()), 1) if land_elev.size else 0,
            "minDepth": round(float(height.min()), 1),
            "territoryKm2": round(float(terr.sum()) * cell * cell / 1e6, 3),
            "osmIslandKm2": round(t_area / 1e6, 3),
            "landKm2": round(float(land.sum()) * cell * cell / 1e6, 3),
            "flatTerritoryPct": round(float((terr_slope < 6).mean() * 100), 1) if terr_slope.size else 0,
            "demMissingPct": round(float((missing & land).sum()) / max(1, land.sum()) * 100, 2),
            "landApproxPct": round(float((approx & land).sum()) / max(1, land.sum()) * 100, 2),
            "seaApproxPct": round(float(approx_sea.sum()) / max(1, (~land).sum()) * 100, 1),
            "osmBuildings": len(centres),
        },
        "sources": {
            "dem": {"name": "Copernicus DEM GLO-30 (DSM)", "resolution_m": 30, "tiles": tiles,
                    "licence": "Copernicus DEM licence (free use with attribution)",
                    "attribution": "Produced using Copernicus WorldDEM-30 (c) DLR e.V. 2010-2014 and (c) Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved",
                    "url": "https://registry.opendata.aws/copernicus-dem/"},
            "bathymetry": dict(bmeta, method=method, approximated=True),
            "coastline": {"name": "OpenStreetMap natural=coastline", "licence": "ODbL 1.0",
                          "attribution": "(c) OpenStreetMap contributors", "rings": len(rings), "openChains": len(open_chains),
                          "note": ("Open coastline chains (mainland) are resolved from the DEM (>1 m = land)."
                                   if open_chains else "All coastline in the area is closed island rings.")},
        },
        "approximations": [
            "Copernicus GLO-30 is a surface model: forest canopy and buildings are included in land heights (typically +5 to +25 m in dense forest).",
            f"Land cells the DEM puts at or below sea level but OSM marks as land are raised to 0.6-1.0 m ({round(float((low).sum()) * cell * cell / 1e6, 3)} km2).",
            "Sea depth: " + method,
            f"The DEM was resampled bilinearly from 30 m to a {cell:.1f} m grid.",
        ],
        "osm": {"roads": roads, "places": places, "pois": pois, "buildings": bl, "outline": outline},
    }
    with open(os.path.join(out, "terrain.bin"), "wb") as f:
        f.write(np.clip(np.round(height * 4), -32768, 32767).astype("<i2").tobytes())
    with open(os.path.join(out, "mask.bin"), "wb") as f:
        f.write(mask.tobytes())
    with open(os.path.join(out, "meta.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, separators=(",", ":"))
    preview(height, mask, os.path.join(out, "preview.png"))
    log(f"  done: max {meta['stats']['maxElevation']} m, min {meta['stats']['minDepth']} m, territory "
        f"{meta['stats']['territoryKm2']} km2 (OSM {meta['stats']['osmIslandKm2']}), roads {len(roads)}, places {len(places)}, "
        f"buildings {len(bl)}, sea approx {meta['stats']['seaApproxPct']}%")


def slope_deg(hgt, cell):
    gy, gx = np.gradient(hgt, cell)
    return np.degrees(np.arctan(np.hypot(gx, gy)))


def preview(height, mask, path):
    h, w = height.shape
    img = np.zeros((h, w, 3), np.float64)
    sea = (mask & 3) == 0
    d = np.clip(-height / 80, 0, 1)
    img[sea] = (np.stack([20 + 40 * (1 - d), 60 + 100 * (1 - d), 120 + 100 * (1 - d)], -1))[sea]
    e = np.clip(height / max(1, height.max()), 0, 1)
    gy, gx = np.gradient(height)
    shade = np.clip(0.75 + (gx - gy) * 0.05, 0.3, 1.2)
    land_col = np.stack([90 + 120 * e, 130 + 80 * e, 70 + 90 * e], -1) * shade[..., None]
    img[~sea] = land_col[~sea]
    img[(mask & 3) == 1] *= 0.6
    img[(mask & MASK_REEF) > 0] = img[(mask & MASK_REEF) > 0] * 0.6 + np.array([40, 200, 190]) * 0.4
    Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)).save(path)


if __name__ == "__main__":
    ids = sys.argv[1:] or list(LOC)
    for i in ids:
        build(i)
