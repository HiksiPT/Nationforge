import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { BUILDINGS, BUILDING_MAP, CATEGORY_INFO, PORT_UPGRADES, RESOURCES, ROAD_CLASSES, type Category } from '../data/catalogue';
import { TECH_MAP, UNLOCKED_BY } from '../data/research';
import { MASK } from '../geo/terrain';
import { store, useApp, useWorld, type Overlay, type Panel } from '../app/store';
import { resolveEvent, DISASTER_INFO } from '../sim/events';
import { objectiveProgress } from '../sim/engine';
import { weatherIcon, weatherLabel } from '../sim/weather';
import { MONTH_NAMES, dateOf } from '../sim/calendar';
import type { World } from '../sim/world';
import { OVERLAY_INFO } from '../render/overlays';
import { cursor, renderRefs, rig } from '../render/refs';
import { enterFirstPerson, exitFirstPerson } from '../render/FirstPerson';
import { findPortCandidates, type PortSiteReport } from '../sim/port';
import { audio } from '../audio/audio';
import { saveToSlot } from '../app/game';
import { Flag, money, pct, int, signed, Bar } from './widgets';
import { PanelHost } from './panels/PanelHost';

// ------------------------------------------------------------------ top bar

export function TopBar() {
  const world = useWorld(300)!;
  const speed = useApp((s) => s.speed);
  const st = world.state;
  const m = world.lastMonth();
  const prev = st.history[st.history.length - 2];
  const d = dateOf(st.day, st.startYear);
  const set = (p: Panel) => store.set({ panel: store.get().panel === p ? null : p });
  return (
    <div className="topbar panel">
      <div className="row" style={{ gap: 10, cursor: 'pointer' }} onClick={() => set('government')} title="Government">
        <Flag flag={st.nation.flag} w={40} />
        <div className="col" style={{ gap: 0 }}>
          <b style={{ fontSize: 14 }}>{st.nation.name}</b>
          <span className="tiny muted">{world.scenario.name}</span>
        </div>
      </div>
      <div className="stat" onClick={() => set('log')} title="Calendar and weather">
        <span className="l">{weatherIcon(st.weather)} {weatherLabel(st.weather)} · {Math.round(st.weather.temp)}°C</span>
        <span className="v">{d.day} {MONTH_NAMES[d.month].slice(0, 3)} {d.year}</span>
        <span className="d muted">wind {Math.round(st.weather.wind)} m/s</span>
      </div>
      <div className="row speed" style={{ gap: 2, padding: '0 6px' }}>
        {[0, 1, 2, 3, 4].map((s) => (
          <button key={s} className={speed === s ? 'on' : ''} title={s === 0 ? 'Pause (Space)' : `Speed ${s} (${s})`} onClick={() => store.set({ speed: s })}>
            {s === 0 ? '⏸' : '▶'.repeat(Math.min(s, 3)) + (s === 4 ? '+' : '')}
          </button>
        ))}
      </div>
      <div className="stat" onClick={() => set('economy')}>
        <span className="l">Treasury</span>
        <span className={`v ${st.treasury < 0 ? 'bad' : ''}`}>{money(st.treasury)}</span>
        <span className={`d ${(m?.balance ?? 0) >= 0 ? 'good' : 'bad'}`}>{signed(m?.balance ?? 0, (v) => money(v))}/mo</span>
      </div>
      <div className="stat" onClick={() => set('population')}>
        <span className="l">Population</span>
        <span className="v">{int(st.pop)}</span>
        <span className={`d ${(m ? m.immigrants - m.emigrants : 0) >= 0 ? 'good' : 'bad'}`}>{m ? signed(Math.round(m.immigrants - m.emigrants + m.births - m.deaths), int) : ''}/mo</span>
      </div>
      <div className="stat" onClick={() => set('economy')}>
        <span className="l">GDP</span>
        <span className="v">{money(m?.gdpAnnual ?? 0)}</span>
        <span className={`d ${(m?.gdpGrowth ?? 0) >= 0 ? 'good' : 'bad'}`}>{m && st.history.length > 2 ? signed(m.gdpGrowth * 100, (v) => v.toFixed(1)) + '%' : '–'} · {money(m?.gdpPerCapita ?? 0)}/p</span>
      </div>
      <div className="stat" onClick={() => set('government')}>
        <span className="l">Approval</span>
        <span className={`v ${st.approval < 35 ? 'bad' : st.approval < 50 ? 'warn' : 'good'}`}>{Math.round(st.approval)}%</span>
        <span className="d muted">stability {Math.round(st.stability * 100)}</span>
      </div>
      <div className="stat" onClick={() => set('population')}>
        <span className="l">Jobs</span>
        <span className={`v ${(m?.unemployment ?? 0) > 0.1 ? 'bad' : ''}`}>{pct(m?.unemployment ?? 0, 1)}</span>
        <span className="d muted">unemployed</span>
      </div>
      <div className="stat" onClick={() => set('environment')}>
        <span className="l">Environment</span>
        <span className={`v ${st.env.quality < 50 ? 'bad' : ''}`}>{Math.round(st.env.quality)}</span>
        <span className="d muted">{world.scenario.marineName.split(' ')[0].toLowerCase()} {Math.round(st.env.marine)}</span>
      </div>
      <span className="spacer" />
      {st.disasters.map((x, i) => (
        <span key={i} className="chip bad" title={DISASTER_INFO[x.kind].name}>
          {DISASTER_INFO[x.kind].icon} {DISASTER_INFO[x.kind].name}
        </span>
      ))}
      <button className="btn sm" title="Save (Ctrl+S)" onClick={() => saveToSlot(store.get().slot ?? 'slot1')}>
        💾
      </button>
      <button className="btn sm" title="Menu, saves and settings" onClick={() => set('saves')}>
        ☰
      </button>
    </div>
  );
}

// ------------------------------------------------------------------ toolbar & build menu

const PANELS: { p: Exclude<Panel, null>; icon: string; tip: string }[] = [
  { p: 'economy', icon: '📈', tip: 'Economy & budget' },
  { p: 'government', icon: '🏛', tip: 'Government & policy' },
  { p: 'population', icon: '👥', tip: 'Population & housing' },
  { p: 'trade', icon: '🌍', tip: 'Trade & diplomacy' },
  { p: 'regions', icon: '🗺', tip: 'Regions' },
  { p: 'environment', icon: '🌿', tip: 'Environment & disasters' },
  { p: 'research', icon: '🔬', tip: 'Research' },
  { p: 'objectives', icon: '🎯', tip: 'Objectives' },
  { p: 'ports', icon: '⚓', tip: 'Port site planner' },
  { p: 'geo', icon: '🛰', tip: 'Geo data (developer panel)' },
];

export function Toolbar() {
  const tool = useApp((s) => s.tool);
  const panel = useApp((s) => s.panel);
  const [cat, setCat] = useState<string | null>(null);
  useEffect(() => {
    if (tool.kind === 'select') setCat((c) => (c === 'roads' || c === 'zones' || (c && c in CATEGORY_INFO) ? c : null));
  }, [tool.kind]);
  const pick = (c: string) => {
    audio.click();
    setCat(cat === c ? null : c);
  };
  return (
    <>
      <div className="toolbar panel">
        <button className={`tb ${tool.kind === 'select' && !cat ? 'on' : ''}`} onClick={() => (setCat(null), store.set({ tool: { kind: 'select' }, pending: null, roadStart: null }))}>
          👆<span className="tip">Select & inspect (Esc)</span>
        </button>
        <button className={`tb ${cat === 'roads' ? 'on' : ''}`} onClick={() => pick('roads')}>
          🛣<span className="tip">Roads</span>
        </button>
        <button className={`tb ${cat === 'zones' ? 'on' : ''}`} onClick={() => pick('zones')}>
          ▦<span className="tip">Zoning</span>
        </button>
        {(Object.keys(CATEGORY_INFO) as Category[]).map((c) => (
          <button key={c} className={`tb ${cat === c ? 'on' : ''}`} onClick={() => pick(c)}>
            {CATEGORY_INFO[c].icon}
            <span className="tip">{CATEGORY_INFO[c].name}</span>
          </button>
        ))}
        <button className={`tb ${tool.kind === 'bulldoze' ? 'on' : ''}`} onClick={() => (setCat(null), store.set({ tool: { kind: 'bulldoze' }, pending: null }))}>
          🧨<span className="tip">Demolish</span>
        </button>
        <div className="sep" style={{ margin: '4px 0' }} />
        {PANELS.map((x) => (
          <button key={x.p} className={`tb ${panel === x.p ? 'on' : ''}`} onClick={() => store.set({ panel: panel === x.p ? null : x.p })}>
            {x.icon}
            <span className="tip">{x.tip}</span>
          </button>
        ))}
        <div className="sep" style={{ margin: '4px 0' }} />
        <OverlayButton />
        <ViewButtons />
      </div>
      {cat && <BuildMenu cat={cat} onClose={() => setCat(null)} />}
    </>
  );
}

function OverlayButton() {
  const overlay = useApp((s) => s.overlay);
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: 'relative' }}>
      <button className={`tb ${overlay !== 'none' ? 'on' : ''}`} onClick={() => setOpen(!open)}>
        🗺️<span className="tip">Map overlays</span>
      </button>
      {open && (
        <div className="panel col" style={{ position: 'absolute', left: 50, top: -120, width: 220, padding: 6, gap: 1, zIndex: 40 }}>
          {(Object.keys(OVERLAY_INFO) as Overlay[]).map((o) => (
            <button key={o} className={`btn sm ${overlay === o ? 'on' : 'ghost'}`} style={{ textAlign: 'left' }} onClick={() => (store.set({ overlay: o }), setOpen(false))}>
              {OVERLAY_INFO[o].name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ViewButtons() {
  const world = useApp((s) => s.world)!;
  return (
    <>
      <button className="tb" onClick={() => store.set({ cameraCmd: { kind: 'preset', preset: 'national', n: Date.now() } })}>
        🌐<span className="tip">National view</span>
      </button>
      <button className="tb" onClick={() => store.set({ cameraCmd: { kind: 'preset', preset: 'regional', n: Date.now() } })}>
        🏘<span className="tip">Regional view</span>
      </button>
      <button className="tb" onClick={() => store.set({ cameraCmd: { kind: 'preset', preset: 'city', n: Date.now() } })}>
        🏠<span className="tip">City view</span>
      </button>
      <button className="tb" onClick={() => enterFirstPerson(world, rig.target.x, rig.target.z)}>
        🚶<span className="tip">Walk here (first person)</span>
      </button>
    </>
  );
}

function BuildMenu({ cat, onClose }: { cat: string; onClose: () => void }) {
  const world = useWorld(500)!;
  const tool = useApp((s) => s.tool);
  const brush = useApp((s) => s.brush);
  const ci = world.costIndex();
  if (cat === 'roads') {
    return (
      <div className="buildmenu panel">
        <div className="row" style={{ padding: '10px 12px' }}>
          <h3>Roads</h3>
          <span className="spacer" />
          <button className="btn sm ghost" onClick={onClose}>✕</button>
        </div>
        <div className="col" style={{ padding: '0 6px 8px' }}>
          {Object.values(ROAD_CLASSES).map((r) => {
            const locked = r.needs && !world.hasTech(r.needs);
            return (
              <button key={r.id} className={`bitem ${tool.kind === 'road' && tool.cls === r.id ? 'on' : ''} ${locked ? 'locked' : ''}`} disabled={!!locked} onClick={() => store.set({ tool: { kind: 'road', cls: r.id }, roadStart: null, pending: null })}>
                <b>{r.name}</b>
                <span className="num small">${Math.round(r.costPerM * ci)}/m</span>
                <span className="tiny muted" style={{ gridColumn: '1 / 3' }}>
                  Max grade {Math.round(r.maxGrade * 100)}% · {r.width} m wide{locked ? ` · needs ${TECH_MAP[r.needs!].name}` : ''}
                </span>
              </button>
            );
          })}
          <div className="tiny muted" style={{ padding: 8 }}>Click a start point, then an end point. Routes follow the terrain and switch back to stay within the grade limit. Right-click or Esc cancels.</div>
        </div>
      </div>
    );
  }
  if (cat === 'zones') {
    const zt = tool.kind === 'zone' ? tool.zone : undefined;
    return (
      <div className="buildmenu panel">
        <div className="row" style={{ padding: '10px 12px' }}>
          <h3>Zoning</h3>
          <span className="spacer" />
          <button className="btn sm ghost" onClick={onClose}>✕</button>
        </div>
        <div className="col" style={{ padding: '0 10px 10px', gap: 6 }}>
          {([['R', 'Residential', 'Private homes grow here when people want to move in.'], ['C', 'Commercial', 'Shops and offices grow with population.'], ['I', 'Industrial', 'Workshops and factories grow when there are idle workers and investors.']] as const).map(([z, n, d]) => (
            <button key={z} className={`bitem ${zt === z ? 'on' : ''}`} onClick={() => store.set({ tool: { kind: 'zone', zone: z } })}>
              <b>{n}</b>
              <span className="num small">${Math.round(1500 * world.state.priceIndex)}/cell</span>
              <span className="tiny muted" style={{ gridColumn: '1 / 3' }}>{d}</span>
            </button>
          ))}
          <button className={`bitem ${tool.kind === 'zone' && zt === null ? 'on' : ''}`} onClick={() => store.set({ tool: { kind: 'zone', zone: null } })}>
            <b>Clear zoning</b>
            <span className="small">free</span>
          </button>
          <label className="col small">
            Brush radius: {brush} m
            <input type="range" min={20} max={300} step={10} value={brush} onChange={(e) => store.set({ brush: +e.target.value })} />
          </label>
          <div className="tiny muted">Zones must be on your own land, slopes under 14°, within 55 m of a road for buildings to grow. Private investors pay for the buildings.</div>
        </div>
      </div>
    );
  }
  const items = BUILDINGS.filter((b) => b.cat === cat && (!b.only || b.only.includes(world.state.scenario)) && !(b.id === 'heritage_restoration' && !world.scenario.landmark));
  return (
    <div className="buildmenu panel">
      <div className="row" style={{ padding: '10px 12px' }}>
        <h3>{CATEGORY_INFO[cat as Category].icon} {CATEGORY_INFO[cat as Category].name}</h3>
        <span className="spacer" />
        <button className="btn sm ghost" onClick={onClose}>✕</button>
      </div>
      <div className="col scroll" style={{ padding: '0 6px 8px', gap: 2 }}>
        {items.map((b) => {
          const locked = !world.isUnlocked(b);
          const exists = b.unique && world.state.buildings.some((x) => x.type === b.id);
          return (
            <button key={b.id} className={`bitem ${tool.kind === 'build' && tool.type === b.id ? 'on' : ''} ${locked || exists ? 'locked' : ''}`} disabled={locked || exists} onClick={() => (audio.click(), store.set({ tool: { kind: 'build', type: b.id }, pending: null, hover: null, rotation: 0 }))}>
              <b>{b.name}</b>
              <span className="num small">{money(b.cost * ci)}</span>
              <span className="tiny muted" style={{ gridColumn: '1 / 3' }}>
                {[b.housing && `${b.housing} homes`, b.jobs && `${b.jobs} jobs`, b.beds && `${b.beds} beds`, b.port && `${b.port.capacity.toLocaleString()} t/mo, ${b.port.minDepth} m draught`, (b.power ?? 0) > 0 && `${b.power} MW`, (b.water ?? 0) > 0 && `${b.water!.toLocaleString()} m³/mo`, `${b.days} days`].filter(Boolean).join(' · ')}
                {locked && b.needs ? ` · needs ${TECH_MAP[b.needs].name}` : ''}
                {exists ? ' · already built' : ''}
              </span>
            </button>
          );
        })}
        {cat === 'port' && <div className="tiny muted" style={{ padding: 8 }}>Ports snap to your coastline and face the sea. Compare sites first in the Port planner (⚓ below). Breakwaters, dredging, quays, customs and links are added from a port’s info panel.</div>}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ placement confirmation

export function PendingPanel() {
  const world = useApp((s) => s.world)!;
  const pending = useApp((s) => s.pending);
  const hover = useApp((s) => s.hover);
  const tool = useApp((s) => s.tool);
  if (!pending) {
    if (tool.kind === 'build' && hover) return <HoverCard world={world} type={tool.type} />;
    if (tool.kind === 'road') {
      return (
        <div className="pending panel small">
          <b>{ROAD_CLASSES[tool.cls].name}</b> — {store.get().roadStart ? 'click the end point (the route preview follows the terrain)' : 'click the start point on your land'} · right-click to cancel
        </div>
      );
    }
    if (tool.kind === 'zone') return <div className="pending panel small">Drag to paint {tool.zone ? `${tool.zone === 'R' ? 'residential' : tool.zone === 'C' ? 'commercial' : 'industrial'} zoning` : 'to clear zoning'} · brush {store.get().brush} m · Esc to stop</div>;
    if (tool.kind === 'bulldoze') return <div className="pending panel small bad">Demolish: click a building or road</div>;
    return null;
  }
  if (pending.kind === 'road') {
    const p = pending.plan;
    return (
      <div className="pending panel">
        <div className="row">
          <h3>Build {ROAD_CLASSES[p.cls].name.toLowerCase()}?</h3>
        </div>
        <div className="kv small" style={{ margin: '8px 0' }}>
          <span>Length</span><span>{int(p.length / world.terrain.hs)} m real ({int(p.length)} m in game)</span>
          <span>Steepest grade</span><span>{pct(p.maxGrade, 1)} (limit {pct(ROAD_CLASSES[p.cls].maxGrade, 0)})</span>
          <span>Average grade</span><span>{pct(p.avgGrade, 1)}</span>
          <span>Construction</span><span>~{p.days} days (weather permitting)</span>
          {p.forestCells > 0 && <><span>Forest cleared</span><span className="warn">{p.forestCells} cells</span></>}
          {p.protectedCells > 0 && <><span>Protected land crossed</span><span className="warn">{p.protectedCells} cells</span></>}
          <span><b>Cost</b></span><span><b>{money(p.cost)}</b></span>
        </div>
        <div className="row">
          <button className="btn" onClick={() => store.set({ pending: null })}>Cancel</button>
          <span className="spacer" />
          <button className="btn primary" disabled={p.cost > world.state.treasury} onClick={() => {
            const r = world.buildRoad(p);
            if (r.ok) {
              audio.confirm();
              store.set({ pending: null, roadStart: p.pts[p.pts.length - 1] });
              store.toast(`Road under construction (${money(p.cost)})`);
            } else {
              audio.error();
              store.toast(r.error ?? 'Failed', 'err');
            }
          }}>
            Build road
          </button>
        </div>
      </div>
    );
  }
  const res = pending.result;
  const def = BUILDING_MAP[pending.type];
  return (
    <div className="pending panel">
      <div className="row">
        <h3>{def.name}</h3>
        <span className="spacer" />
        <span className="chip">Suitability {res.suitability}%</span>
      </div>
      <PlacementDetails world={world} res={res} />
      <div className="row" style={{ marginTop: 8 }}>
        <button className="btn" onClick={() => store.set({ pending: null })}>Cancel</button>
        <span className="spacer" />
        <button className="btn primary" disabled={!res.ok} onClick={() => {
          const r = world.placeBuilding(pending.type, pending.x, pending.z, pending.rot);
          if (r.ok) {
            audio.confirm();
            store.set({ pending: null });
            store.toast(`${def.name}: construction started (${money(r.building!.cost)})`);
          } else {
            audio.error();
            store.toast(r.error ?? 'Failed', 'err');
          }
        }}>
          Confirm – {money(res.cost)}
        </button>
      </div>
    </div>
  );
}

function HoverCard({ world, type }: { world: World; type: string }) {
  const res = useApp((s) => s.hover)!;
  const def = BUILDING_MAP[type];
  return (
    <div className="pending panel small" style={{ opacity: 0.95 }}>
      <div className="row">
        <b>{def.name}</b>
        <span className="spacer" />
        <span className={res.ok ? 'good' : 'bad'}>{res.ok ? money(res.cost) : res.errors[0]}</span>
        <span className="chip">{res.suitability}%</span>
      </div>
      <div className="tiny muted">Click to review and confirm · R rotates · right-click cancels{res.warnings.length ? ` · ⚠ ${res.warnings[0]}` : ''}</div>
      {void world}
    </div>
  );
}

export function PlacementDetails({ world, res }: { world: World; res: import('../sim/placement').PlacementResult }) {
  return (
    <div className="col" style={{ gap: 6, marginTop: 6 }}>
      {res.errors.map((e) => (
        <div key={e} className="bad small">✖ {e}</div>
      ))}
      <div>
        {res.checks.map((c) => (
          <div key={c.label} className="check small">
            <span className={c.state === 'ok' ? 'good' : c.state === 'warn' ? 'warn' : 'bad'}>{c.state === 'ok' ? '✔' : c.state === 'warn' ? '⚠' : '✖'}</span>
            <span>{c.label}</span>
            <span className="muted">{c.detail}</span>
          </div>
        ))}
      </div>
      {res.warnings.length > 0 && (
        <div className="col tiny warn" style={{ gap: 2 }}>
          {res.warnings.map((w) => (
            <span key={w}>⚠ {w}</span>
          ))}
        </div>
      )}
      <div className="grid2">
        <div>
          <div className="tiny muted">Cost breakdown</div>
          <div className="kv tiny">
            {res.costItems.flatMap((c) => [<span key={c.label + 'l'}>{c.label}</span>, <span key={c.label + 'v'}>{money(c.amount)}</span>])}
          </div>
        </div>
        <div>
          <div className="tiny muted">Suitability</div>
          {res.suitItems.map((s) => (
            <div key={s.label} className="tiny">
              <div className="row"><span>{s.label}</span><span className="spacer" /><span>{Math.round(s.score)}</span></div>
              <Bar v={s.score / 100} color={s.score > 65 ? 'var(--good)' : s.score > 35 ? 'var(--warn)' : 'var(--bad)'} />
            </div>
          ))}
        </div>
      </div>
      {res.consultDays > 0 && <div className="tiny muted">Work begins after {res.consultDays} days of consultation.</div>}
      {void world}
    </div>
  );
}

// ------------------------------------------------------------------ info panel for the selection

export function InfoPanel() {
  const world = useWorld(400)!;
  const sel = useApp((s) => s.selection);
  if (!sel) return null;
  const close = () => store.set({ selection: null });
  let body: JSX.Element | null = null;
  if (sel.kind === 'building') {
    const b = world.building(sel.id);
    if (!b) return null;
    body = <BuildingInfo world={world} id={b.id} />;
  } else if (sel.kind === 'road') {
    const r = world.state.roads.find((x) => x.id === sel.id);
    if (!r) return null;
    body = (
      <div className="kv small">
        <span>Type</span><span>{ROAD_CLASSES[r.cls].name}{r.osm ? ' (existing, from OpenStreetMap)' : ''}</span>
        <span>Length</span><span>{int(r.length / world.terrain.hs)} m real</span>
        <span>Status</span><span>{r.status === 'active' ? 'Open' : `Under construction ${Math.round(r.progress * 100)}%`}</span>
        <span>Network</span><span>{world.hubComponents.has(world.roadComponents.get(r.id) ?? -1) ? 'Connected to port / town hall' : 'Local network only'}</span>
      </div>
    );
  } else {
    body = <TerrainInfo world={world} x={sel.x} z={sel.z} />;
  }
  return (
    <div className="info panel">
      <div className="row" style={{ padding: '10px 12px', borderBottom: '1px solid var(--line)' }}>
        <b>{sel.kind === 'building' ? BUILDING_MAP[world.building(sel.id)!.type].name : sel.kind === 'road' ? 'Road' : 'Terrain'}</b>
        <span className="spacer" />
        <button className="btn sm ghost" onClick={close}>✕</button>
      </div>
      <div className="scroll" style={{ padding: 12 }}>{body}</div>
    </div>
  );
}

function BuildingInfo({ world, id }: { world: World; id: number }) {
  const b = world.building(id)!;
  const d = BUILDING_MAP[b.type];
  const ops = b.ops;
  const isPort = !!d.port;
  return (
    <div className="col" style={{ gap: 8 }}>
      <div className="small muted">{d.desc}</div>
      <div className="row tiny" style={{ flexWrap: 'wrap', gap: 4 }}>
        <span className="chip">{b.owner === 'state' ? 'State owned' : b.owner === 'private' ? 'Private' : 'Community'}</span>
        <span className="chip">{world.state.regions[b.region]?.name}</span>
        <span className="chip">{b.style}</span>
      </div>
      {b.status === 'construction' ? (
        <div>
          <div className="row small"><span>{(b.consultDays ?? 0) > 0 ? `Community consultation: ${b.consultDays} days left` : 'Under construction'}</span><span className="spacer" /><b>{Math.round(b.progress * 100)}%</b></div>
          <Bar v={b.progress} color="var(--accent)" />
          <div className="tiny muted" style={{ marginTop: 4 }}>About {Math.ceil((1 - b.progress) * d.days)} good-weather days left. Rain, wind and storms slow work.</div>
        </div>
      ) : (
        <div className="kv small">
          <span>Condition</span><span className={b.condition < 0.7 ? 'bad' : ''}>{Math.round(b.condition * 100)}%</span>
          {d.housing && <><span>Homes</span><span>{d.housing}</span></>}
          {d.jobs && <><span>Workers</span><span>{ops ? `${ops.workers.toFixed(1)} / ${ops.jobs.toFixed(0)}` : d.jobs}</span></>}
          {ops && <><span>Efficiency</span><span>{pct(ops.efficiency, 0)}</span></>}
          {ops && Object.entries(ops.output).flatMap(([k, v]) => [<span key={k}>{RESOURCES[k as keyof typeof RESOURCES].name}</span>, <span key={k + 'v'}>{(v as number).toFixed(1)} {RESOURCES[k as keyof typeof RESOURCES].unit}/mo</span>])}
          {ops && (ops.revenue !== 0 || ops.profit !== 0) && <><span>Revenue</span><span>{money(ops.revenue)}/mo</span><span>Profit</span><span className={ops.profit < 0 ? 'bad' : 'good'}>{money(ops.profit)}/mo</span></>}
          {(d.power ?? 0) !== 0 && <><span>Power</span><span>{d.power! > 0 ? `+${d.power} MW nameplate` : `${Math.round(-d.power! * 1000)} kW`}</span></>}
          {(d.water ?? 0) !== 0 && <><span>Water</span><span>{d.water! > 0 ? '+' : ''}{int(d.water!)} m³/mo</span></>}
          {d.service && <><span>Serves</span><span>{d.service.kind}, {d.service.radius > 50000 ? 'whole island' : `${d.service.radius} m radius`}</span></>}
          {d.research && <><span>Research</span><span>{d.research} pts/mo</span></>}
        </div>
      )}
      {ops && ops.issues.length > 0 && (
        <div className="col tiny" style={{ gap: 2 }}>
          {ops.issues.map((i) => (
            <span key={i} className={/No road|short|shortage|Damaged/i.test(i) ? 'warn' : 'muted'}>• {i}</span>
          ))}
        </div>
      )}
      {isPort && <PortInfo world={world} id={id} />}
      <div className="row" style={{ flexWrap: 'wrap' }}>
        {b.condition < 0.99 && b.status !== 'construction' && (
          <button className="btn sm" disabled={world.repairCost(b) > world.state.treasury} onClick={() => world.repair(b.id)}>
            Repair {money(world.repairCost(b))}
          </button>
        )}
        <button className="btn sm" onClick={() => store.focus(b.x, b.z, 260)}>Focus</button>
        <button className="btn sm" onClick={() => enterFirstPerson(world, b.x + Math.sin(b.rot) * (d.size[1] / 2 + 12), b.z + Math.cos(b.rot) * (d.size[1] / 2 + 12))}>Walk here</button>
        <span className="spacer" />
        <button className="btn sm danger" onClick={() => store.askConfirm({ title: `Demolish ${d.name}?`, body: 'This cannot be undone.', confirmLabel: 'Demolish', danger: true, onConfirm: () => (world.bulldoze(b.id), audio.demolish(), store.set({ confirm: null, selection: null })) })}>
          Demolish
        </button>
      </div>
    </div>
  );
}

function PortInfo({ world, id }: { world: World; id: number }) {
  const b = world.building(id)!;
  const d = BUILDING_MAP[b.type];
  const lm = world.lastMonth();
  return (
    <div className="card col" style={{ gap: 6 }}>
      <b className="small">Port facilities</b>
      <div className="kv tiny">
        <span>Berth depth</span><span>{(b.depth ?? 0).toFixed(1)} m (ships need {d.port!.minDepth} m)</span>
        <span>Shelter</span><span>{Math.round((b.shelter ?? 0) * 100)}%</span>
        <span>Island trade this month</span><span>{int(lm?.tradeUsed ?? 0)} / {int(lm?.tradeCapacity ?? 0)} t</span>
      </div>
      {PORT_UPGRADES.map((u) => {
        const count = b.upgrades?.[u.id] ?? 0;
        const pend = b.pending?.filter((p) => p.id === u.id) ?? [];
        const max = u.repeatable ?? 1;
        const locked = (u.needs && !world.hasTech(u.needs)) || (u.minTier && d.port!.tier < u.minTier);
        const cost = world.portUpgradeCost(b, u.id);
        const done = count + pend.length >= max;
        return (
          <div key={u.id} className="row tiny" title={u.desc} style={{ gap: 6 }}>
            <span style={{ flex: 1 }}>
              <b>{u.name}</b> {count > 0 && <span className="good">✔{max > 1 ? `×${count}` : ''}</span>}
              {pend.length > 0 && <span className="warn"> building {Math.round(pend[0].progress * 100)}%</span>}
              <div className="dim">{u.desc}</div>
            </span>
            <button className="btn sm" disabled={!!locked || done || b.status === 'construction' || !isFinite(cost) || cost > world.state.treasury} onClick={() => {
              const r = world.startPortUpgrade(b.id, u.id);
              if (r.ok) (audio.confirm(), store.toast(`${u.name} started`));
              else (audio.error(), store.toast(r.error ?? 'Failed', 'err'));
            }}>
              {locked ? (u.needs ? TECH_MAP[u.needs].name : 'larger port') : done ? 'done' : !isFinite(cost) ? 'n/a' : money(cost)}
            </button>
          </div>
        );
      })}
    </div>
  );
}

function TerrainInfo({ world, x, z }: { world: World; x: number; z: number }) {
  const t = world.terrain;
  const real = t.realAt(x, z);
  const m = t.flagsAt(x, z);
  const cls = m & 3;
  const flags = [m & MASK.protected && 'protected area', m & MASK.forest && 'woodland', m & MASK.reef && (world.scenario.id === 'moorea' ? 'reef / lagoon' : 'sensitive shallows'), m & MASK.beach && 'beach', m & MASK.community && 'community land', m & MASK.approx && 'approximated data'].filter(Boolean) as string[];
  const site = cls !== MASK.sea && t.coastDistAt(x, z) < 250 ? world.portSite(x, z, store.get().portFocus) : null;
  return (
    <div className="col" style={{ gap: 8 }}>
      <div className="kv small">
        <span>{real >= 0 ? 'Elevation' : 'Water depth'}</span><span>{Math.abs(real).toFixed(1)} m real</span>
        <span>In game</span><span>{t.heightAt(x, z).toFixed(1)} m (×{t.vs} vertical)</span>
        <span>Slope</span><span>{t.slopeAt(x, z).toFixed(1)}°</span>
        <span>Land</span><span>{cls === MASK.territory ? 'Your territory' : cls === MASK.foreign ? world.scenario.foreignNames[0] ?? 'Neighbouring land' : 'Sea'}</span>
        <span>Distance to coast</span><span>{int(t.coastDistAt(x, z) / t.hs)} m real</span>
        <span>Region</span><span>{world.state.regions[world.regionAt(x, z)]?.name}</span>
        <span>Zone</span><span>{['none', 'residential', 'commercial', 'industrial'][world.state.zones[t.idx(x, z)]]}</span>
      </div>
      {flags.length > 0 && <div className="row tiny" style={{ flexWrap: 'wrap', gap: 4 }}>{flags.map((f) => <span key={f} className="chip">{f}</span>)}</div>}
      {site && <SiteCard world={world} s={site} />}
      <div className="row">
        <button className="btn sm" onClick={() => enterFirstPerson(world, x, z)}>Walk here</button>
      </div>
    </div>
  );
}

export function SiteCard({ world, s, compact = false }: { world: World; s: PortSiteReport; compact?: boolean }) {
  const focus = store.get().portFocus;
  return (
    <div className="card col" style={{ gap: 6 }}>
      <div className="row">
        <b className="small">Port site: {s.name}</b>
        <span className="spacer" />
        <span className={`chip ${s.score >= 60 ? 'good' : s.score >= 40 ? 'warn' : 'bad'}`}>score {s.score}</span>
      </div>
      <div className="kv tiny">
        <span>Shelter</span><span>{Math.round(s.shelter * 100)}% (most exposed to {s.exposureDir})</span>
        <span>Depth at berth / approach</span><span>{Math.max(0, s.berthDepth).toFixed(1)} / {Math.max(0, s.approachDepth).toFixed(1)} m</span>
        <span>Shore slope</span><span>{s.slope.toFixed(1)}°</span>
        <span>Flat land within 400 m</span><span>{s.flatLand.toFixed(1)} ha (real)</span>
        <span>Environmental sensitivity</span><span className={s.sensitivity > 0.4 ? 'bad' : s.sensitivity > 0.15 ? 'warn' : 'good'}>{Math.round(s.sensitivity * 100)}%{s.sensitivityNotes.length ? ` – ${s.sensitivityNotes.join(', ')}` : ''}</span>
        <span>Road link</span><span>{isFinite(s.roadDistance) ? `${int(s.roadDistance)} m` : 'none nearby'}</span>
      </div>
      {!compact && (
        <table className="t tiny">
          <thead><tr><th>Port type</th><th className="r">Est. total</th><th>Notes</th></tr></thead>
          <tbody>
            {s.costs.map((c) => (
              <tr key={c.type} className={c.type === focus ? 'hl' : ''}>
                <td>{c.name}</td>
                <td className="r">{c.feasible ? money(c.total) : '–'}</td>
                <td className={c.feasible ? 'muted' : 'bad'}>{c.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="row">
        <button className="btn sm" onClick={() => store.focus(s.x, s.z, 450)}>Focus</button>
        <span className="spacer" />
        <button className="btn sm primary" onClick={() => {
          const type = focus;
          const res = world.evaluate(type, s.x, s.z, s.rot);
          store.set({ tool: { kind: 'build', type }, pending: { kind: 'building', type, x: res.snap?.x ?? s.x, z: res.snap?.z ?? s.z, rot: res.snap?.rot ?? s.rot, result: res }, panel: null });
          store.focus(s.x, s.z, 420);
        }}>
          Build {BUILDING_MAP[focus].name.toLowerCase()} here
        </button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ dialogs, events, toasts, notifications

export function ConfirmDialog() {
  const c = useApp((s) => s.confirm);
  if (!c) return null;
  return (
    <div className="modal-bg">
      <div className="modal panel col" style={{ gap: 12 }}>
        <h2>{c.title}</h2>
        <div className="muted">{c.body}</div>
        <div className="row">
          <button className="btn" onClick={() => store.set({ confirm: null })}>Cancel</button>
          <span className="spacer" />
          <button className={`btn ${c.danger ? 'danger' : 'primary'}`} onClick={() => c.onConfirm()}>{c.confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

export function EventModal() {
  const world = useWorld(300)!;
  const e = world.state.pendingEvents[0];
  useEffect(() => {
    if (e) audio.notify();
  }, [e?.uid]);
  if (!e) return null;
  return (
    <div className="modal-bg">
      <div className="modal panel col" style={{ gap: 12 }}>
        <div className="tiny muted">Decision · the clock is paused</div>
        <h2>{e.title}</h2>
        <div style={{ lineHeight: 1.5 }}>{e.text}</div>
        <div className="col" style={{ gap: 6 }}>
          {e.choices.map((c, i) => (
            <button key={i} className="btn" style={{ textAlign: 'left', padding: '8px 12px' }} onClick={() => (audio.click(), resolveEvent(world, e.uid, i))}>
              <b>{c.label}</b>
              <div className="tiny muted">{c.desc}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function Toasts() {
  const t = useApp((s) => s.toast);
  const [items, setItems] = useState<{ id: number; text: string; kind: string }[]>([]);
  useEffect(() => {
    if (!t) return;
    setItems((x) => [...x.slice(-3), { id: t.n, text: t.text, kind: t.kind }]);
    if (t.kind === 'err') audio.error();
    const h = setTimeout(() => setItems((x) => x.filter((i) => i.id !== t.n)), 3500);
    return () => clearTimeout(h);
  }, [t?.n]);
  return (
    <div className="toasts">
      {items.map((i) => (
        <div key={i.id} className={`toast ${i.kind}`}>{i.text}</div>
      ))}
    </div>
  );
}

export function Notifications() {
  const world = useWorld(500)!;
  const [open, setOpen] = useState(true);
  const notes = world.state.notifications.slice(0, open ? 30 : 3);
  const lastId = useRef(0);
  useEffect(() => {
    const top = world.state.notifications[0];
    if (top && top.id !== lastId.current) {
      if (lastId.current && (top.kind === 'bad' || top.kind === 'good')) audio.notify();
      lastId.current = top.id;
    }
  });
  return (
    <div className="notes panel">
      <div className="row" style={{ padding: '6px 10px' }}>
        <b className="small">Notifications</b>
        <span className="spacer" />
        <button className="btn sm ghost" onClick={() => setOpen(!open)}>{open ? '▾' : '▴'}</button>
      </div>
      <div className="scroll" style={{ padding: '0 8px 8px' }}>
        {notes.map((n) => (
          <div key={n.id} className={`note k-${n.kind}`} onClick={() => n.at && store.focus(n.at[0], n.at[1], 400)}>
            <div className="row tiny"><b>{n.title}</b><span className="spacer" /><span className="dim">{dateLabel(world, n.day)}</span></div>
            {n.text && open && <div className="tiny muted">{n.text}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

function dateLabel(world: World, day: number) {
  const d = dateOf(day, world.state.startYear);
  return `${d.day} ${MONTH_NAMES[d.month].slice(0, 3)}`;
}

export function OverlayLegend() {
  const overlay = useApp((s) => s.overlay);
  const tool = useApp((s) => s.tool);
  const o = tool.kind === 'zone' ? 'zones' : overlay;
  if (o === 'none') return null;
  const info = OVERLAY_INFO[o];
  return (
    <div className="legend panel small">
      <b>{info.name}</b>
      {info.legend.map(([c, l]) => (
        <span key={l}><i style={{ background: c }} />{l}</span>
      ))}
      {overlay !== 'none' && <button className="btn sm ghost" onClick={() => store.set({ overlay: 'none' })}>✕</button>}
    </div>
  );
}

// ------------------------------------------------------------------ labels projected from 3D

export function Labels() {
  const world = useApp((s) => s.world)!;
  const show = useApp((s) => s.settings.showLabels);
  const panel = useApp((s) => s.panel);
  const portFocus = useApp((s) => s.portFocus);
  const ref = useRef<HTMLDivElement>(null);
  const [sites, setSites] = useState<PortSiteReport[]>([]);
  useEffect(() => {
    if (panel === 'ports') setSites(findPortCandidates(world, portFocus, 6));
    else setSites([]);
  }, [panel, portFocus, world]);
  const items = useRef<{ text: string; cls: string; x: number; z: number; minDist: number; maxDist: number; site?: PortSiteReport }[]>([]);
  const [, setVersion] = useState(0);
  useEffect(() => {
    const t = world.terrain;
    const arr: typeof items.current = [];
    for (const p of t.meta.osm.places) {
      const [x, z] = t.osmToWorld(p.p);
      const isPlace = ['town', 'village'].includes(p.kind);
      const isSmall = ['hamlet', 'locality', 'isolated_dwelling'].includes(p.kind);
      if (p.kind === 'neighbourhood' || p.kind === 'suburb') continue;
      if (!isPlace && !isSmall && !['peak', 'bay', 'cape', 'lighthouse', 'historic'].includes(p.kind)) continue;
      if (p.kind === 'peak' && (p.ele ?? 0) < (t.meta.stats.maxElevation > 300 ? 150 : 40)) continue;
      const cls = p.kind === 'peak' ? 'peak' : p.kind === 'bay' || p.kind === 'cape' ? 'bay' : '';
      arr.push({ text: p.kind === 'peak' && p.ele ? `▲ ${p.name} ${Math.round(p.ele)} m` : p.name, cls, x, z, minDist: 0, maxDist: isPlace ? 1e9 : isSmall ? 2500 : p.kind === 'bay' ? 3000 : 6000 });
    }
    if (world.scenario.landmark) {
      const [x, z] = t.toWorld(...world.scenario.landmark.p);
      arr.push({ text: `★ ${world.scenario.landmark.name}`, cls: 'landmark', x, z, minDist: 0, maxDist: 1e9 });
    }
    for (const r of world.state.regions) arr.push({ text: r.name, cls: 'region', x: r.seed[0], z: r.seed[1], minDist: Math.max(t.widthM, t.depthM) * 0.45, maxDist: 1e9 });
    sites.forEach((s, i) => arr.push({ text: `⚓ ${i + 1}. ${s.name} – ${s.score}`, cls: 'site', x: s.x, z: s.z, minDist: 0, maxDist: 1e9, site: s }));
    items.current = arr;
    setVersion((v) => v + 1);
  }, [world, sites]);
  useEffect(() => {
    let raf = 0;
    const v = new THREE.Vector3();
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const cam = renderRefs.camera;
      const el = ref.current;
      if (!cam || !el) return;
      const w = el.clientWidth, h = el.clientHeight;
      const kids = el.children;
      const fpView = store.get().view === 'firstperson';
      for (let i = 0; i < kids.length; i++) {
        const it = items.current[i];
        const node = kids[i] as HTMLElement;
        if (!it) {
          node.style.display = 'none';
          continue;
        }
        const y = Math.max(0, world.terrain.heightAt(it.x, it.z)) + 25;
        v.set(it.x, y, it.z);
        const dist = cam.position.distanceTo(v);
        v.project(cam);
        const vis = (show || it.cls === 'site') && !fpView && v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1 && rig.dist <= it.maxDist && rig.dist >= it.minDist && dist < store.get().settings.viewDistance * 1200;
        node.style.display = vis ? 'block' : 'none';
        if (vis) node.style.transform = `translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px) translate(-50%, -100%)`;
      }
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [world, show]);
  return (
    <div className="labels" ref={ref}>
      {items.current.map((it, i) => (
        <div key={i + it.text} className={`label ${it.cls}`} style={{ left: 0, top: 0 }} onClick={() => {
          if (it.site) store.set({ selection: { kind: 'site', x: it.site.x, z: it.site.z } });
        }}>
          {it.text}
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ minimap

export function Minimap() {
  const world = useApp((s) => s.world)!;
  const ref = useRef<SVGRectElement>(null);
  const t = world.terrain;
  const W = 180, H = (180 * t.H) / t.W > 160 ? 160 : (180 * t.H) / t.W;
  const sx = W / t.W, sy = H / t.H;
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const r = ref.current;
      if (!r) return;
      const [fx, fy] = t.toGrid(rig.target.x, rig.target.z);
      const span = (rig.dist * 1.2) / t.cell;
      r.setAttribute('x', String((fx - span / 2) * sx));
      r.setAttribute('y', String((fy - span / 2) * sy));
      r.setAttribute('width', String(span * sx));
      r.setAttribute('height', String(span * sy));
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [t, sx, sy]);
  return (
    <div className="minimap panel" style={{ height: H + 8 }}>
      <svg width={W} height={H} onClick={(e) => {
        const r = (e.target as SVGElement).closest('svg')!.getBoundingClientRect();
        const [x, z] = t.toWorld((e.clientX - r.left) / sx, (e.clientY - r.top) / sy);
        store.focus(x, z, rig.dist);
      }} style={{ cursor: 'pointer', background: '#0e3350', borderRadius: 6 }}>
        <image href={`${import.meta.env.BASE_URL}data/${world.state.scenario}/preview.png`} width={W} height={H} preserveAspectRatio="none" opacity={0.9} />
        {t.meta.osm.outline.map((ring, i) => (
          <polygon key={i} points={ring.map((p) => `${p[0] * sx},${p[1] * sy}`).join(' ')} fill="none" stroke="#e8c66a" strokeWidth={1} />
        ))}
        <rect ref={ref} fill="rgba(255,255,255,0.12)" stroke="#fff" strokeWidth={1} />
      </svg>
    </div>
  );
}

// ------------------------------------------------------------------ tutorial

const TUTORIAL: { title: string; text: string; done: (w: World) => boolean }[] = [
  { title: 'Inspect the terrain', text: 'This is real elevation data. Drag to pan, right-drag to rotate, scroll to zoom. Click the ground to see elevation, slope and land type. Try the overlays (🗺️) for slope and buildable land.', done: () => store.get().selection?.kind === 'terrain' || store.get().overlay !== 'none' },
  { title: 'Compare port sites', text: 'Open the Port planner (⚓ on the left toolbar). It scans your coastline for shelter, depth, slope, flat land, cost and environmental sensitivity.', done: () => store.get().panel === 'ports' },
  { title: 'Build a port', text: 'Pick a site and press "Build … here", or choose a port from the Ports & maritime build menu and click the coast. Review the costs and checks, then confirm.', done: (w) => w.ports().some((p) => p.owner === 'state' && p.cost > 0) },
  { title: 'Link it with a road', text: 'Select your port and add a Road link, or draw roads from the Roads menu. Roads follow the terrain within their grade limit.', done: (w) => w.state.roads.some((r) => !r.osm && r.cost > 0) },
  { title: 'Homes, jobs, power and water', text: 'Place houses near roads, then jobs (farm, shop, distillery…), power (wind turbine) and water (borehole or cistern). Buildings need road access to operate.', done: (w) => w.state.buildings.filter((b) => b.owner === 'state' && b.cost > 0).length >= 5 },
  { title: 'Zone for private growth', text: 'Paint residential and commercial zones along roads. Investors build there when people want to move in.', done: (w) => w.state.zones.some((z) => z > 0) },
  { title: 'Run the country', text: 'Unpause (Space) and watch the monthly economy. The Economy, Government and Trade panels explain what is happening and let you set taxes, budgets and policies. Good luck!', done: () => false },
];

export function Tutorial() {
  const world = useWorld(500)!;
  const st = world.state;
  const step = st.tutorialStep;
  useEffect(() => {
    if (step >= 0 && step < TUTORIAL.length - 1 && TUTORIAL[step].done(world)) {
      st.tutorialStep = step + 1;
      world.emit();
    }
  });
  if (step < 0 || step >= TUTORIAL.length || !store.get().settings.tutorials) return null;
  const s = TUTORIAL[step];
  return (
    <div className="tutorial panel col" style={{ gap: 6, left: 'auto', right: 210, top: 64 }}>
      <div className="row tiny muted"><span>Tutorial {step + 1}/{TUTORIAL.length}</span><span className="spacer" /><button className="btn sm ghost" onClick={() => ((st.tutorialStep = -1), world.emit())}>Skip</button></div>
      <b>{s.title}</b>
      <div className="small" style={{ lineHeight: 1.45 }}>{s.text}</div>
      <div className="row"><span className="spacer" /><button className="btn sm" onClick={() => ((st.tutorialStep = step + 1), world.emit())}>{step === TUTORIAL.length - 1 ? 'Finish' : 'Next'}</button></div>
    </div>
  );
}

// ------------------------------------------------------------------ first person HUD

export function FirstPersonHUD() {
  const world = useWorld(500)!;
  const [locked, setLocked] = useState(false);
  useEffect(() => {
    const f = () => setLocked(!!document.pointerLockElement);
    document.addEventListener('pointerlockchange', f);
    return () => document.removeEventListener('pointerlockchange', f);
  }, []);
  const t = world.terrain;
  const x = rig.target.x, z = rig.target.z;
  return (
    <div className="fp-hud">
      <div className="crosshair" />
      <div className="panel small" style={{ position: 'absolute', left: 12, top: 12, padding: '8px 12px' }}>
        <b>{world.state.nation.name}</b> · {world.dateString()} · {weatherLabel(world.state.weather)}
        <div className="tiny muted">{world.state.regions[world.regionAt(x, z)]?.name} · {Math.max(0, t.realAt(x, z)).toFixed(0)} m above sea level</div>
      </div>
      {!locked && (
        <div className="modal-bg" style={{ background: 'rgba(5,10,16,0.35)' }}>
          <div className="panel col" style={{ padding: 18, gap: 10, width: 380 }}>
            <h3>First-person walk</h3>
            <div className="small muted">Click the view to look around. WASD to walk, Shift to run, Space to jump, Esc to release the mouse.</div>
            <div className="row">
              <button className="btn" onClick={() => exitFirstPerson()}>Return to map</button>
              <span className="spacer" />
              <button className="btn primary" onClick={() => renderRefs.canvas?.requestPointerLock?.()}>Look around</button>
            </div>
          </div>
        </div>
      )}
      <button className="btn" style={{ position: 'absolute', right: 12, top: 12 }} onClick={() => exitFirstPerson()}>Return to map (M)</button>
    </div>
  );
}

// ------------------------------------------------------------------ objectives mini tracker

export function ObjectiveTracker() {
  const world = useWorld(1000)!;
  const m = world.lastMonth();
  const next = world.scenario.objectives.find((o) => world.state.objectives[o.id] == null);
  if (!next) return null;
  const p = Math.min(1, objectiveProgress(world, next, m));
  return (
    <div className="panel small" style={{ position: 'absolute', right: 8, top: 242, width: 190, padding: '8px 10px', cursor: 'pointer' }} onClick={() => store.set({ panel: 'objectives' })}>
      <div className="tiny muted">Next objective</div>
      <div>{next.text}</div>
      <Bar v={p} color="var(--accent)" />
      {void cursor}
      {void UNLOCKED_BY}
    </div>
  );
}

export function Drawer() {
  const panel = useApp((s) => s.panel);
  if (!panel) return null;
  return <PanelHost panel={panel} />;
}
