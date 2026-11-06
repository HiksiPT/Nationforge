"""Write src/data/fallbacks.json: a compact copy of each island's metadata and real OSM outline.

The game uses it to build a clearly labelled fallback terrain (real coastline shape, modelled heights)
if the DEM package in public/data cannot be loaded.
"""
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
out = {}
for lid in json.load(open(os.path.join(ROOT, "tools", "locations.json"), encoding="utf-8")):
    m = json.load(open(os.path.join(ROOT, "public", "data", lid, "meta.json"), encoding="utf-8"))
    keep = {k: m[k] for k in ("id", "name", "country", "format", "width", "height", "cellReal", "hscale", "vscale",
                              "verticalExaggeration", "center", "bbox", "stats", "sources", "approximations")}
    keep["osm"] = {"roads": [], "places": [p for p in m["osm"]["places"] if p["kind"] in ("village", "town", "hamlet", "peak", "bay")][:40],
                   "pois": [], "buildings": [], "outline": m["osm"]["outline"]}
    out[lid] = keep
with open(os.path.join(ROOT, "src", "data", "fallbacks.json"), "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
print("ok", {k: len(v["osm"]["outline"]) for k, v in out.items()})
