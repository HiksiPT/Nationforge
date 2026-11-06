import { useEffect, useState } from 'react';
import { SCENARIOS, type Scenario } from '../data/scenarios';
import fallbacks from '../data/fallbacks.json';
import { startNewGame, loadSlot } from '../app/game';
import { store, useApp } from '../app/store';
import { listSlots, type SlotInfo } from '../save/storage';
import type { FlagSpec } from '../sim/types';
import { Flag } from './widgets';
import { SavesPanel } from './panels/SavesPanel';
import { SettingsPanel } from './panels/SettingsPanel';
import { formatDate } from '../sim/calendar';

const PATTERNS: FlagSpec['pattern'][] = ['tricolour-v', 'tricolour-h', 'cross', 'canton', 'diagonal', 'circle', 'chevron'];
const EMBLEMS: FlagSpec['emblem'][] = ['none', 'star', 'sun', 'wave', 'mountain', 'fish'];
const SUGGEST: Record<string, { name: string; flag: FlagSpec; motto: string }> = {
  shuna: { name: 'Republic of Shuna', flag: { pattern: 'cross', colors: ['#1f4e8c', '#ffffff', '#2e8b57'], emblem: 'none' }, motto: 'Cha till sinn tuilleadh' },
  makri: { name: 'Makri Free State', flag: { pattern: 'tricolour-h', colors: ['#38a8d8', '#ffffff', '#38a8d8'], emblem: 'sun' }, motto: 'Sun, sea and stewardship' },
  lastovo: { name: 'Lastovo Commonwealth', flag: { pattern: 'chevron', colors: ['#1f4e8c', '#c8102e', '#ffffff'], emblem: 'star' }, motto: 'Small island, open sea' },
  guafo: { name: 'Guafo Research Territory', flag: { pattern: 'diagonal', colors: ['#2e8b57', '#1f4e8c', '#ffffff'], emblem: 'wave' }, motto: 'Para la isla, con la isla' },
  moorea: { name: 'Moorea Island Authority', flag: { pattern: 'tricolour-h', colors: ['#c8102e', '#ffffff', '#c8102e'], emblem: 'sun' }, motto: 'Together with the lagoon' },
};

export function MainMenu() {
  const [mode, setMode] = useState<'home' | 'new' | 'load' | 'settings'>('home');
  const [slots, setSlots] = useState<SlotInfo[]>([]);
  useEffect(() => {
    listSlots().then(setSlots).catch(() => setSlots([]));
  }, [mode]);
  const latest = slots.find((s) => s.ok);
  return (
    <div className="menu">
      <div className="menu-hero">
        <div className="row" style={{ alignItems: 'flex-end', gap: 18 }}>
          <div>
            <div className="logo">NATIONFORGE</div>
            <div className="muted" style={{ fontSize: 15, marginTop: 2 }}>Build a nation on a real island. Five real places, real elevation data, real coastlines.</div>
          </div>
          <span className="spacer" />
          {mode !== 'home' && (
            <button className="btn" onClick={() => setMode('home')}>
              ← Back
            </button>
          )}
        </div>
        <div style={{ height: 26 }} />
        {mode === 'home' && (
          <div className="row" style={{ alignItems: 'flex-start', gap: 28, flexWrap: 'wrap' }}>
            <div className="col" style={{ width: 280, gap: 10 }}>
              {latest && (
                <button className="btn primary" style={{ padding: '12px 16px', fontSize: 15 }} onClick={() => loadSlot(latest.slot)}>
                  Continue – {latest.nation}
                  <div className="tiny" style={{ fontWeight: 400 }}>{latest.name}</div>
                </button>
              )}
              <button className={`btn ${latest ? '' : 'primary'}`} style={{ padding: '12px 16px', fontSize: 15 }} onClick={() => setMode('new')}>
                New nation
              </button>
              <button className="btn" style={{ padding: '10px 16px' }} onClick={() => setMode('load')}>
                Load game ({slots.length})
              </button>
              <button className="btn" style={{ padding: '10px 16px' }} onClick={() => setMode('settings')}>
                Settings
              </button>
            </div>
            <div className="loc-grid" style={{ flex: 1, minWidth: 320 }}>
              {SCENARIOS.map((s) => (
                <LocCard key={s.id} s={s} selected={false} onClick={() => setMode('new')} />
              ))}
            </div>
          </div>
        )}
        {mode === 'new' && <NewGame />}
        {mode === 'load' && (
          <div className="panel" style={{ padding: 16, maxWidth: 760 }}>
            <SavesPanel inMenu />
          </div>
        )}
        {mode === 'settings' && (
          <div className="panel scroll" style={{ padding: 16, maxWidth: 760, maxHeight: '75vh' }}>
            <SettingsPanel />
          </div>
        )}
        <p className="tiny dim" style={{ marginTop: 28, maxWidth: 900 }}>
          Terrain: Copernicus DEM GLO-30 (© DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018, provided under COPERNICUS by the European Union and ESA). Bathymetry: EMODnet Bathymetry (CC BY 4.0), AWS Terrain Tiles (ETOPO1/GEBCO), with labelled coastal approximations. Coastlines, roads, places: © OpenStreetMap contributors (ODbL). All scenarios are fictional.
        </p>
      </div>
    </div>
  );
}

function LocCard({ s, selected, onClick }: { s: Scenario; selected: boolean; onClick: () => void }) {
  const meta = (fallbacks as any)[s.id];
  return (
    <button className={`loc ${selected ? 'sel' : ''}`} onClick={onClick}>
      <img src={`${import.meta.env.BASE_URL}data/${s.id}/preview.png`} alt={`${s.name} relief from the real DEM`} />
      <div className="body">
        <div className="row">
          <b style={{ fontSize: 15 }}>{s.name}</b>
          <span className="spacer" />
          <span className="stars" title={`Difficulty ${s.difficultyLevel}/5`}>{'★'.repeat(s.difficultyLevel)}<span className="dim">{'★'.repeat(5 - s.difficultyLevel)}</span></span>
        </div>
        <div className="muted small">{s.country}</div>
        <div className="small" style={{ marginTop: 6 }}>{s.tagline}</div>
        {meta && (
          <div className="row tiny muted" style={{ marginTop: 6, flexWrap: 'wrap', gap: 6 }}>
            <span className="chip">{meta.stats.osmIslandKm2.toFixed(1)} km²</span>
            <span className="chip">{Math.round(meta.stats.maxElevation)} m high</span>
            <span className="chip">scale ×{meta.hscale}</span>
          </div>
        )}
      </div>
    </button>
  );
}

function NewGame() {
  const [sel, setSel] = useState('shuna');
  const sc = SCENARIOS.find((s) => s.id === sel)!;
  const [name, setName] = useState(SUGGEST.shuna.name);
  const [flag, setFlag] = useState<FlagSpec>(SUGGEST.shuna.flag);
  const [motto, setMotto] = useState(SUGGEST.shuna.motto);
  const tutorials = useApp((s) => s.settings.tutorials);
  const settings = useApp((s) => s.settings);
  const pick = (id: string) => {
    setSel(id);
    setName(SUGGEST[id].name);
    setFlag(SUGGEST[id].flag);
    setMotto(SUGGEST[id].motto);
  };
  const meta = (fallbacks as any)[sel];
  return (
    <div className="row" style={{ alignItems: 'flex-start', gap: 20, flexWrap: 'wrap' }}>
      <div className="loc-grid" style={{ flex: '1 1 520px' }}>
        {SCENARIOS.map((s) => (
          <LocCard key={s.id} s={s} selected={s.id === sel} onClick={() => pick(s.id)} />
        ))}
      </div>
      <div className="panel col" style={{ flex: '0 1 420px', padding: 16, gap: 10 }}>
        <h2>{sc.name}</h2>
        <div className="muted">{sc.country}</div>
        <p className="small" style={{ margin: 0, lineHeight: 1.5 }}>{sc.intro}</p>
        <div>
          <div className="small muted">Challenges</div>
          <ul className="small" style={{ margin: '4px 0 0', paddingLeft: 18 }}>
            {sc.difficulty.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        </div>
        {meta && (
          <div className="kv small">
            <span>Island area (OSM)</span><span>{meta.stats.osmIslandKm2.toFixed(2)} km²</span>
            <span>Highest point (DEM)</span><span>{Math.round(meta.stats.maxElevation)} m</span>
            <span>Gameplay scale</span><span>×{meta.hscale} horizontal, ×{meta.vscale} vertical</span>
            <span>Starting residents</span><span>{sc.startPop.toLocaleString()}</span>
            <span>Starting funds</span><span>${(sc.startFunds / 1e6).toFixed(0)}M{sc.startDebt ? ` (debt $${sc.startDebt / 1e6}M)` : ''}</span>
          </div>
        )}
        {sc.ethics && <div className="card tiny" style={{ borderColor: 'rgba(232,198,106,0.4)' }}>{sc.ethics}</div>}
        <div className="sep" />
        <label className="col small">
          Nation name
          <input type="text" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="col small">
          Motto
          <input type="text" value={motto} maxLength={60} onChange={(e) => setMotto(e.target.value)} />
        </label>
        <div className="row" style={{ alignItems: 'flex-start', gap: 12 }}>
          <Flag flag={flag} w={84} />
          <div className="col small" style={{ flex: 1 }}>
            <select value={flag.pattern} onChange={(e) => setFlag({ ...flag, pattern: e.target.value as FlagSpec['pattern'] })}>
              {PATTERNS.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
            <div className="row">
              {[0, 1, 2].map((i) => (
                <input key={i} type="color" value={flag.colors[i]} onChange={(e) => {
                  const c = [...flag.colors] as FlagSpec['colors'];
                  c[i] = e.target.value;
                  setFlag({ ...flag, colors: c });
                }} />
              ))}
              <select value={flag.emblem} onChange={(e) => setFlag({ ...flag, emblem: e.target.value as FlagSpec['emblem'] })}>
                {EMBLEMS.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
        <label className="row small">
          <input type="checkbox" checked={tutorials} onChange={(e) => store.set({ settings: { ...settings, tutorials: e.target.checked } })} /> Show the tutorial
        </label>
        <button className="btn primary" style={{ padding: '10px 14px', fontSize: 15 }} onClick={() => startNewGame(sel, name.trim() || sc.name, flag, motto)}>
          Found {name.trim() || sc.name}
        </button>
        <div className="tiny dim">Game starts on {formatDate(0, 2031)}.</div>
      </div>
    </div>
  );
}
