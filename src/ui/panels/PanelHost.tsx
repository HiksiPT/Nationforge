import { useEffect, useMemo, useState } from 'react';
import { BUILDING_MAP, RESOURCES, type ResId } from '../../data/catalogue';
import { TECHS, TECH_MAP } from '../../data/research';
import { PLAYER_STYLES, STYLES } from '../../data/styles';
import { store, useApp, useWorld, type Panel } from '../../app/store';
import { DIPLO_ACTIONS, diplomacyAction, type DiploAction } from '../../sim/diplomacy';
import { DISASTER_INFO } from '../../sim/events';
import { objectiveProgress } from '../../sim/engine';
import { MONTH_SHORT } from '../../sim/calendar';
import { findPortCandidates } from '../../sim/port';
import type { World } from '../../sim/world';
import { renderRefs } from '../../render/refs';
import { SiteCard } from '../HUD';
import { Bar, BarList, Flag, Legend, LineChart, Seg, Slider, int, money, pct, signed } from '../widgets';
import { SavesPanel } from './SavesPanel';
import { SettingsPanel } from './SettingsPanel';

const TITLES: Record<Exclude<Panel, null>, string> = {
  economy: 'Economy & budget',
  government: 'Government & policy',
  population: 'Population & housing',
  trade: 'Trade & diplomacy',
  regions: 'Regions & districts',
  environment: 'Environment & disasters',
  research: 'Research',
  objectives: 'Objectives',
  ports: 'Port site planner',
  geo: 'Geo data (developer)',
  settings: 'Settings',
  saves: 'Game menu',
  help: 'How to play',
  log: 'Chronicle',
};

export function PanelHost({ panel }: { panel: Exclude<Panel, null> }) {
  return (
    <div className="drawer panel">
      <div className="head">
        <h2 style={{ fontSize: 17 }}>{TITLES[panel]}</h2>
        <span className="spacer" />
        <button className="btn sm ghost" onClick={() => store.set({ panel: null })}>✕</button>
      </div>
      <div className="body scroll">
        {panel === 'economy' && <EconomyPanel />}
        {panel === 'government' && <GovernmentPanel />}
        {panel === 'population' && <PopulationPanel />}
        {panel === 'trade' && <TradePanel />}
        {panel === 'regions' && <RegionsPanel />}
        {panel === 'environment' && <EnvironmentPanel />}
        {panel === 'research' && <ResearchPanel />}
        {panel === 'objectives' && <ObjectivesPanel />}
        {panel === 'ports' && <PortsPanel />}
        {panel === 'geo' && <GeoPanel />}
        {panel === 'settings' && <SettingsPanel />}
        {panel === 'saves' && <SavesPanel />}
        {panel === 'help' && <HelpPanel />}
        {panel === 'log' && <LogPanel />}
      </div>
    </div>
  );
}

function hist(w: World, n = 60) {
  return w.state.history.slice(-n);
}

function labels(w: World, n = 60) {
  return hist(w, n).map((h) => `${MONTH_SHORT[h.month]} ${h.year}`);
}

function Explain({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <div className="card col" style={{ gap: 3 }}>
      <b className="small">What changed this month</b>
      {items.map((e, i) => (
        <div key={i} className="small">• {e}</div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ economy

function EconomyPanel() {
  const w = useWorld(500)!;
  const [tab, setTab] = useState<'overview' | 'budget' | 'debt' | 'history'>('overview');
  const m = w.lastMonth();
  const st = w.state;
  const P = st.policy;
  if (!m) return null;
  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="tabs">
        {(['overview', 'budget', 'debt', 'history'] as const).map((t) => (
          <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{{ overview: 'Overview', budget: 'Taxes & budget', debt: 'Debt & finance', history: 'History' }[t]}</button>
        ))}
      </div>
      {tab === 'overview' && (
        <>
          <div className="grid3">
            <Kpi l="GDP (12 months)" v={money(m.gdpAnnual)} d={st.history.length > 12 ? `${signed(m.gdpGrowth * 100, (x) => x.toFixed(1))}% a year` : 'first year'} />
            <Kpi l="GDP per person" v={money(m.gdpPerCapita)} />
            <Kpi l="Inflation" v={pct(m.inflation)} d={`price level ${m.priceIndex.toFixed(3)}`} />
            <Kpi l="Unemployment" v={pct(m.unemployment)} d={`${int(m.employed)} of ${int(m.labour)} employed`} />
            <Kpi l="Average wage" v={money(m.wage)} d="per worker per month" />
            <Kpi l="Budget balance" v={money(m.balance)} d={m.balance >= 0 ? 'surplus' : 'deficit'} bad={m.balance < 0} />
          </div>
          <Explain items={m.explain} />
          <div className="grid2">
            <div>
              <b className="small">Economy by sector (this month)</b>
              <BarList items={Object.entries(m.sectors).filter(([, v]) => Math.abs(v) > 1).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: k, value: v }))} format={(v) => money(v)} />
            </div>
            <div>
              <b className="small">Industry output</b>
              <BarList items={Object.entries(collectOutput(w)).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => ({ label: `${RESOURCES[k as ResId].name}`, value: v, color: RESOURCES[k as ResId].color }))} format={(v) => `${v.toFixed(1)} t`} />
              {Object.keys(collectOutput(w)).length === 0 && <div className="tiny muted">No industry yet: farms, fisheries and workshops produce goods.</div>}
            </div>
          </div>
          <div className="tiny muted">Industries need land, workers, power, water, inputs and road access; their goods are sold at home or exported through your ports at world prices less foreign tariffs.</div>
        </>
      )}
      {tab === 'budget' && (
        <>
          <div className="grid2">
            <div className="col" style={{ gap: 8 }}>
              <b className="small">Taxes</b>
              <Slider label="Income tax" value={P.incomeTax} min={0} max={0.45} step={0.01} format={(v) => pct(v, 0)} onChange={(v) => w.setPolicy({ incomeTax: v })} />
              <Slider label="Corporate tax" value={P.corporateTax} min={0} max={0.4} step={0.01} format={(v) => pct(v, 0)} onChange={(v) => w.setPolicy({ corporateTax: v })} />
              <Slider label="Sales tax" value={P.salesTax} min={0} max={0.25} step={0.01} format={(v) => pct(v, 0)} onChange={(v) => w.setPolicy({ salesTax: v })} />
              <Slider label="Tourism levy" value={P.tourismTax} min={0} max={0.15} step={0.005} format={(v) => pct(v, 1)} onChange={(v) => w.setPolicy({ tourismTax: v })} />
              <Slider label="Property tax (annual)" value={P.propertyTax} min={0} max={0.02} step={0.001} format={(v) => pct(v, 1)} onChange={(v) => w.setPolicy({ propertyTax: v })} />
              <Slider label="Import tariff" value={P.tariff} min={0} max={0.3} step={0.01} format={(v) => pct(v, 0)} onChange={(v) => w.setPolicy({ tariff: v })} />
            </div>
            <div className="col" style={{ gap: 8 }}>
              <b className="small">Spending (100% = normal)</b>
              {(['education', 'health', 'safety', 'infrastructure', 'environment', 'culture'] as const).map((k) => (
                <Slider key={k} label={k[0].toUpperCase() + k.slice(1)} value={P.budget[k]} min={0.5} max={1.5} step={0.05} format={(v) => pct(v, 0)} onChange={(v) => w.setPolicy({ budget: { ...P.budget, [k]: v } })} />
              ))}
            </div>
          </div>
          <div className="grid2">
            <div>
              <b className="small">Revenue {money(m.revenue)}</b>
              <BarList items={Object.entries(m.revenueItems).map(([k, v]) => ({ label: k, value: v, color: 'var(--good)' }))} format={(v) => money(v)} />
            </div>
            <div>
              <b className="small">Spending {money(m.expenditure)}</b>
              <BarList items={Object.entries(m.expenseItems).map(([k, v]) => ({ label: k, value: v, color: 'var(--bad)' }))} format={(v) => money(v)} />
            </div>
          </div>
          <div className="tiny muted">Changes apply from next month. Higher taxes raise revenue but cost approval and investment; budgets change service quality, research and approval.</div>
        </>
      )}
      {tab === 'debt' && <DebtTab w={w} />}
      {tab === 'history' && (
        <>
          <b className="small">GDP per month</b>
          <LineChart series={[{ name: 'GDP', color: '#5fb3e8', data: hist(w).map((h) => h.gdp) }]} labels={labels(w)} format={(v) => money(v)} />
          <b className="small">Revenue and spending</b>
          <Legend series={[{ name: 'Revenue', color: '#5fd08a' }, { name: 'Spending', color: '#ff6b5e' }]} />
          <LineChart series={[{ name: 'Revenue', color: '#5fd08a', data: hist(w).map((h) => h.revenue) }, { name: 'Spending', color: '#ff6b5e', data: hist(w).map((h) => h.expenditure) }]} labels={labels(w)} format={(v) => money(v)} />
          <b className="small">Unemployment and inflation (%)</b>
          <Legend series={[{ name: 'Unemployment', color: '#f2c94c' }, { name: 'Inflation', color: '#c38bff' }]} />
          <LineChart series={[{ name: 'Unemployment', color: '#f2c94c', data: hist(w).map((h) => h.unemployment * 100) }, { name: 'Inflation', color: '#c38bff', data: hist(w).map((h) => h.inflation * 100) }]} labels={labels(w)} format={(v) => v.toFixed(1)} />
          <b className="small">Treasury and debt</b>
          <LineChart series={[{ name: 'Treasury', color: '#e8c66a', data: hist(w).map((h) => h.treasury) }, { name: 'Debt', color: '#ff6b5e', data: hist(w).map((h) => h.debt) }]} labels={labels(w)} format={(v) => money(v)} />
        </>
      )}
    </div>
  );
}

function collectOutput(w: World): Record<string, number> {
  const out: Record<string, number> = {};
  for (const b of w.state.buildings) for (const [k, v] of Object.entries(b.ops?.output ?? {})) out[k] = (out[k] ?? 0) + (v as number);
  return out;
}

function DebtTab({ w }: { w: World }) {
  const m = w.lastMonth()!;
  const st = w.state;
  const limit = w.borrowLimit();
  const ratio = st.debt / Math.max(1, m.gdpAnnual);
  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="grid3">
        <Kpi l="Public debt" v={money(st.debt)} d={`${pct(ratio, 0)} of GDP`} bad={ratio > 0.9} />
        <Kpi l="Interest rate" v={pct(m.interestRate)} d={`${money((st.debt * m.interestRate) / 12)}/month`} />
        <Kpi l="Credit rating" v={st.creditRating} d={`stability ${Math.round(st.stability * 100)}`} />
      </div>
      <Slider label="Borrowing limit (share of annual GDP)" value={st.policy.maxDebtRatio} min={0} max={1.5} step={0.05} format={(v) => pct(v, 0)} onChange={(v) => w.setPolicy({ maxDebtRatio: v })} />
      <label className="row small"><input type="checkbox" checked={st.policy.autoBorrow} onChange={(e) => w.setPolicy({ autoBorrow: e.target.checked })} /> Borrow automatically when the treasury runs dry</label>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <span className="small muted">Can still borrow {money(limit)}</span>
        <span className="spacer" />
        {[1e6, 5e6, 20e6].map((a) => (
          <button key={a} className="btn sm" disabled={limit < a} onClick={() => w.borrow(a)}>Borrow {money(a, 0)}</button>
        ))}
        {[1e6, 5e6].map((a) => (
          <button key={'r' + a} className="btn sm" disabled={st.debt <= 0 || st.treasury < a} onClick={() => w.repay(a)}>Repay {money(a, 0)}</button>
        ))}
      </div>
      <div className="tiny muted">Interest rises with debt above 60% of GDP and with political instability. Bond markets downgrade you as debt grows; ratings feed back into rates.</div>
    </div>
  );
}

function Kpi({ l, v, d, bad }: { l: string; v: string; d?: string; bad?: boolean }) {
  return (
    <div className="kpi">
      <div className="l">{l}</div>
      <div className={`v ${bad ? 'bad' : ''}`}>{v}</div>
      {d && <div className="tiny muted">{d}</div>}
    </div>
  );
}

// ------------------------------------------------------------------ government

function GovernmentPanel() {
  const w = useWorld(500)!;
  const st = w.state;
  const m = w.lastMonth();
  const P = st.policy;
  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="row" style={{ gap: 14 }}>
        <Flag flag={st.nation.flag} w={72} />
        <div>
          <h3>{st.nation.name}</h3>
          <div className="small muted"><i>{st.nation.motto}</i></div>
        </div>
      </div>
      <div className="grid3">
        <Kpi l="Approval" v={`${Math.round(st.approval)}%`} bad={st.approval < 35} />
        <Kpi l="Stability" v={`${Math.round(st.stability * 100)}`} />
        <Kpi l="Reputation abroad" v={`${Math.round(st.reputation)}`} />
      </div>
      {m && (
        <div>
          <b className="small">Why people approve (or not)</b>
          <BarList items={Object.entries(m.approvalFactors).filter(([, v]) => Math.abs(v) > 0.2).sort((a, b) => a[1] - b[1]).map(([k, v]) => ({ label: k, value: v, color: v >= 0 ? 'var(--good)' : 'var(--bad)' }))} format={(v) => signed(v, (x) => x.toFixed(1))} />
        </div>
      )}
      <div className="col" style={{ gap: 8 }}>
        <b className="small">Housing policy</b>
        <Seg value={P.housing} options={[{ v: 'market', label: 'Free market' }, { v: 'rent_control', label: 'Rent control' }, { v: 'social', label: 'Social housing subsidy' }]} onChange={(v) => w.setPolicy({ housing: v })} />
        <div className="tiny muted">Rent control caps rents but halves private homebuilding; social housing subsidises affordable homes at a cost.</div>
        <b className="small">Immigration</b>
        <Seg value={P.immigration} options={[{ v: 'closed', label: 'Closed' }, { v: 'restricted', label: 'Restricted' }, { v: 'open', label: 'Open' }, { v: 'skilled', label: 'Skilled only' }]} onChange={(v) => w.setPolicy({ immigration: v })} />
        <b className="small">Environment</b>
        <Seg value={P.environment} options={[{ v: 'lax', label: 'Lax' }, { v: 'balanced', label: 'Balanced' }, { v: 'strict', label: 'Strict' }]} onChange={(v) => w.setPolicy({ environment: v })} />
        <div className="tiny muted">Strict bans building in protected areas and slows polluting industry; lax does the opposite.</div>
        <b className="small">Energy</b>
        <Seg value={P.energy} options={[{ v: 'fossil', label: 'Cheap diesel' }, { v: 'mixed', label: 'Mixed' }, { v: 'green', label: 'Renewable subsidy' }]} onChange={(v) => w.setPolicy({ energy: v })} />
        <b className="small">Architecture for new private buildings</b>
        <div className="row" style={{ flexWrap: 'wrap', gap: 3 }}>
          {PLAYER_STYLES.map((s) => {
            const locked = STYLES[s].needs && !w.hasTech(STYLES[s].needs!);
            return (
              <button key={s} className={`btn sm ${P.style === s ? 'on' : ''}`} disabled={!!locked} title={locked ? `Needs ${TECH_MAP[STYLES[s].needs!].name}` : ''} onClick={() => w.setPolicy({ style: s })}>
                {STYLES[s].name}
              </button>
            );
          })}
        </div>
      </div>
      <div>
        <b className="small">Recent decisions</b>
        {st.eventLog.length === 0 && <div className="tiny muted">No decisions yet.</div>}
        {st.eventLog.slice(0, 8).map((e, i) => (
          <div key={i} className="small">• {e.title} → <span className="muted">{e.choice}</span></div>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ population

function PopulationPanel() {
  const w = useWorld(500)!;
  const m = w.lastMonth();
  if (!m) return null;
  const vac = m.housing - m.pop;
  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="grid3">
        <Kpi l="Residents" v={int(w.state.pop)} d={`peak ${int(w.state.stats.peakPop)}`} />
        <Kpi l="Homes (capacity)" v={int(m.housing)} d={vac >= 0 ? `${int(vac)} vacant` : `${int(-vac)} short`} bad={vac < 0} />
        <Kpi l="Rent index" v={m.rentIndex.toFixed(2)} d={`${money(m.rent)} per person/mo`} bad={m.rentIndex > 1.4} />
        <Kpi l="Jobs" v={int(m.jobs)} d={`labour force ${int(m.labour)}`} />
        <Kpi l="Unemployment" v={pct(m.unemployment)} bad={m.unemployment > 0.1} />
        <Kpi l="Wages" v={money(m.wage)} />
      </div>
      <Explain items={m.explain.filter((e) => /moved|left|homes|worker|rent|Unemployment/i.test(e))} />
      <div>
        <b className="small">Migration this month: +{m.immigrants.toFixed(1)} in, −{m.emigrants.toFixed(1)} out, +{(m.births - m.deaths).toFixed(1)} natural</b>
        <div className="tiny muted" style={{ marginBottom: 4 }}>People move in only when there are vacant homes; how many want to depends on these factors:</div>
        <BarList items={Object.entries(m.migrationFactors).map(([k, v]) => ({ label: k, value: v, color: v >= 0 ? 'var(--good)' : 'var(--bad)' }))} format={(v) => signed(v * 100, (x) => x.toFixed(0))} />
      </div>
      <div>
        <b className="small">Public services coverage</b>
        {Object.entries(m.services).filter(([k]) => k !== 'transport').map(([k, v]) => (
          <div key={k} className="small"><div className="row"><span>{k}</span><span className="spacer" /><span>{pct(v, 0)}</span></div><Bar v={v} color={v > 0.7 ? 'var(--good)' : v > 0.4 ? 'var(--warn)' : 'var(--bad)'} /></div>
        ))}
      </div>
      <b className="small">Population and homes</b>
      <Legend series={[{ name: 'Residents', color: '#5fb3e8' }, { name: 'Homes', color: '#7bc96f' }, { name: 'Jobs', color: '#e8c66a' }]} />
      <LineChart series={[{ name: 'Residents', color: '#5fb3e8', data: hist(w).map((h) => h.pop) }, { name: 'Homes', color: '#7bc96f', data: hist(w).map((h) => h.housing) }, { name: 'Jobs', color: '#e8c66a', data: hist(w).map((h) => h.jobs) }]} labels={labels(w)} format={(v) => int(v)} />
    </div>
  );
}

// ------------------------------------------------------------------ trade & diplomacy

function TradePanel() {
  const w = useWorld(500)!;
  const m = w.lastMonth();
  const [msg, setMsg] = useState('');
  if (!m) return null;
  const st = w.state;
  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="grid3">
        <Kpi l="Exports" v={money(m.exports)} d="goods, services, tourism" />
        <Kpi l="Imports" v={money(m.imports)} />
        <Kpi l="Foreign investment" v={money(m.fdi)} d="this month" />
        <Kpi l="Port capacity" v={`${int(m.tradeCapacity)} t`} d={`${pct(m.tradeUsed / Math.max(1, m.tradeCapacity), 0)} used`} />
        <Kpi l="Visitors" v={int(m.tourists)} d={m.cruise ? `${int(m.cruise)} by cruise ship` : 'this month'} />
        <Kpi l="Import tariff" v={pct(st.policy.tariff, 0)} />
      </div>
      <div className="grid2">
        <div>
          <b className="small">Exports by product</b>
          <BarList items={Object.entries(m.exportsBy).filter(([, v]) => (v ?? 0) > 1).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0)).map(([k, v]) => ({ label: k === 'services' ? 'Services' : k === 'tourism' ? 'Tourism' : RESOURCES[k as ResId].name, value: v ?? 0, color: k in RESOURCES ? RESOURCES[k as ResId].color : undefined }))} format={(v) => money(v)} />
        </div>
        <div>
          <b className="small">Imports</b>
          <BarList items={Object.entries(m.importsBy).filter(([, v]) => (v ?? 0) > 1).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0)).map(([k, v]) => ({ label: RESOURCES[k as ResId].name, value: v ?? 0, color: RESOURCES[k as ResId].color }))} format={(v) => money(v)} />
          {Object.entries(m.shortages).filter(([, v]) => (v ?? 0) > 0.01).map(([k, v]) => (
            <div key={k} className="tiny bad">Shortage: {(v ?? 0).toFixed(1)} t of {RESOURCES[k as ResId].name.toLowerCase()} (port capacity)</div>
          ))}
        </div>
      </div>
      <h3>Foreign relations</h3>
      {msg && <div className="small card">{msg}</div>}
      <table className="t small">
        <thead><tr><th>Country</th><th className="r">Relation</th><th>Trade</th><th className="r">Their tariff</th><th className="r">Visitors</th></tr></thead>
        <tbody>
          {st.countries.map((c) => (
            <CountryRow key={c.id} w={w} id={c.id} onMsg={setMsg} />
          ))}
        </tbody>
      </table>
      <div className="tiny muted">The countries are fictional. Relations drift with your tariffs, environmental record and reputation. Trade deals remove tariffs both ways.</div>
    </div>
  );
}

function CountryRow({ w, id, onMsg }: { w: World; id: string; onMsg: (s: string) => void }) {
  const c = w.state.countries.find((x) => x.id === id)!;
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr style={{ cursor: 'pointer' }} onClick={() => setOpen(!open)}>
        <td><span className="row" style={{ gap: 6 }}><Flag flag={c.flag} w={22} /> {c.name} <span className="tiny dim">{c.traits.join(', ')}</span></span></td>
        <td className={`r ${c.relation > 30 ? 'good' : c.relation < 0 ? 'bad' : ''}`}>{Math.round(c.relation)}</td>
        <td>{c.tradeDeal ? <span className="good">free trade</span> : <span className="dim">none</span>}</td>
        <td className="r">{c.tradeDeal ? '0%' : pct(c.theirTariff, 0)}</td>
        <td className="r">{pct(c.tourismShare, 0)}{c.campaign > 0 ? ' 📣' : ''}</td>
      </tr>
      {open && (
        <tr>
          <td colSpan={5}>
            <div className="col" style={{ gap: 4, padding: '4px 0' }}>
              <div className="tiny muted">Size {c.gdp}× · distance {Math.round(c.distance * 100)} · eager to buy: {c.wants.map((r) => RESOURCES[r].name.toLowerCase()).join(', ')} · invested {money(c.investment)}</div>
              <div className="row" style={{ flexWrap: 'wrap', gap: 4 }}>
                {(Object.keys(DIPLO_ACTIONS) as DiploAction[]).filter((a) => (a === 'cancel_deal' ? c.tradeDeal : a === 'trade_deal' ? !c.tradeDeal : true)).map((a) => {
                  const d = DIPLO_ACTIONS[a];
                  const cost = d.cost(w, c);
                  return (
                    <button key={a} className="btn sm" title={d.desc} onClick={() => onMsg(diplomacyAction(w, c.id, a).msg)}>
                      {d.name}{cost ? ` (${money(cost)})` : ''}
                    </button>
                  );
                })}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ------------------------------------------------------------------ regions

function RegionsPanel() {
  const w = useWorld(500)!;
  const m = w.lastMonth();
  const st = w.state;
  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="grid2">
        <Kpi l="Regional inequality" v={pct(m?.inequality ?? 0, 0)} d="Gini of income per person" bad={(m?.inequality ?? 0) > 0.35} />
        <Kpi l="Economic resilience" v={pct(m?.resilience ?? 0, 0)} d="diversity of sectors and regions" />
      </div>
      <table className="t small">
        <thead><tr><th>Region</th><th className="r">Residents</th><th className="r">Workers</th><th className="r">Output/mo</th><th className="r">Income/p</th><th>Style</th></tr></thead>
        <tbody>
          {st.regions.map((r) => (
            <tr key={r.id} className={st.policy.regionFocus === r.id ? 'hl' : ''}>
              <td><a href="#" onClick={(e) => (e.preventDefault(), store.focus(r.seed[0], r.seed[1], 1500))}>{r.name}</a></td>
              <td className="r">{int(r.stats.pop)}</td>
              <td className="r">{int(r.stats.jobs)}</td>
              <td className="r">{money(r.stats.gdp)}</td>
              <td className="r">{money(r.stats.income)}</td>
              <td>
                <select value={r.style ?? ''} onChange={(e) => ((r.style = (e.target.value || undefined) as any), w.emit())}>
                  <option value="">national default</option>
                  {PLAYER_STYLES.filter((s) => !STYLES[s].needs || w.hasTech(STYLES[s].needs!)).map((s) => <option key={s} value={s}>{STYLES[s].name}</option>)}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="col" style={{ gap: 6 }}>
        <b className="small">Development focus</b>
        <div className="row" style={{ flexWrap: 'wrap', gap: 4 }}>
          <button className={`btn sm ${st.policy.regionFocus < 0 ? 'on' : ''}`} onClick={() => w.setPolicy({ regionFocus: -1 })}>Balanced</button>
          {st.regions.map((r) => (
            <button key={r.id} className={`btn sm ${st.policy.regionFocus === r.id ? 'on' : ''}`} onClick={() => w.setPolicy({ regionFocus: r.id })}>Focus {r.name}</button>
          ))}
        </div>
        <div className="tiny muted">Concentrating investment in one district adds a productivity bonus (agglomeration, +2.5%) but raises inequality and leaves the economy more exposed when a disaster hits that district. Balanced development is fairer and more resilient. Use the Regions overlay to see regional output.</div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ environment

function EnvironmentPanel() {
  const w = useWorld(500)!;
  const st = w.state;
  const m = w.lastMonth();
  const forest = Math.max(0, 1 - st.env.forestLost / Math.max(1, st.env.forestStart));
  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="grid3">
        <Kpi l="Environment quality" v={`${Math.round(st.env.quality)}`} bad={st.env.quality < 50} />
        <Kpi l={w.scenario.marineName} v={`${Math.round(st.env.marine)}`} bad={st.env.marine < 60} />
        <Kpi l="Pollution" v={st.env.pollution.toFixed(1)} />
        <Kpi l="Forest remaining" v={pct(forest, 0)} />
        <Kpi l="Renewable power" v={pct(m?.renewableShare ?? 0, 0)} />
        <Kpi l="Power / water" v={`${(m?.powerSupply ?? 0).toFixed(2)} MW`} d={`${int(m?.waterSupply ?? 0)} m³ water`} />
      </div>
      <div>
        <b className="small">Active hazards</b>
        {st.disasters.length === 0 && <div className="tiny muted">None right now.</div>}
        {st.disasters.map((d, i) => (
          <div key={i} className="small bad">{DISASTER_INFO[d.kind].icon} {DISASTER_INFO[d.kind].name} – {d.days} days left{d.at && <> · <a href="#" onClick={(e) => (e.preventDefault(), store.focus(d.at![0], d.at![1], 900))}>show</a></>}</div>
        ))}
      </div>
      <div>
        <b className="small">Hazards on {w.scenario.name}</b>
        <table className="t small">
          <tbody>
            {w.scenario.disasters.map((d) => {
              const peak = d.season ? Math.max(...d.season) : 1;
              const months = d.season ? d.season.map((v, i) => (v >= peak * 0.6 ? MONTH_SHORT[i] : '')).filter(Boolean).join(' ') : 'any time';
              return (
                <tr key={d.kind}>
                  <td>{DISASTER_INFO[d.kind].icon} {DISASTER_INFO[d.kind].name}</td>
                  <td className="r">{pct(d.p * 12 * (d.season ? d.season.reduce((a, b) => a + b, 0) / 12 : 1), 0)} a year</td>
                  <td className="muted tiny">{months}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="tiny muted">Fire stations cut wildfire damage nearby; breakwaters shelter ports; storm-resilience research cuts all damage by 40%. Diverse regions recover faster.</div>
      </div>
      <b className="small">Environment and {w.scenario.marineName.toLowerCase()}</b>
      <LineChart series={[{ name: 'Environment', color: '#5fd08a', data: hist(w).map((h) => h.envQuality) }, { name: 'Marine', color: '#5fb3e8', data: hist(w).map((h) => h.marine) }]} labels={labels(w)} format={(v) => v.toFixed(0)} />
      <div className="tiny muted">Pollution from industry, diesel power and untreated sewage, forest clearance and coastal works lower these scores. Tourists, residents and eco-minded trading partners all notice.</div>
    </div>
  );
}

// ------------------------------------------------------------------ research

function ResearchPanel() {
  const w = useWorld(500)!;
  const r = w.state.research;
  const tiers = [1, 2, 3, 4, 5];
  const cur = r.current ? TECH_MAP[r.current] : null;
  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="grid3">
        <Kpi l="Research per month" v={r.points.toFixed(1)} d="schools, colleges, institutes" />
        <Kpi l="Current project" v={cur ? cur.name : 'none'} d={cur ? `${Math.round(r.progress)} / ${cur.cost}` : 'pick one below'} />
        <Kpi l="Completed" v={`${r.completed.length} / ${TECHS.length}`} />
      </div>
      {cur && <Bar v={r.progress / cur.cost} color="var(--accent)" />}
      {tiers.map((t) => (
        <div key={t} className="col" style={{ gap: 4 }}>
          <b className="small muted">Tier {t}</b>
          <div className="grid2">
            {TECHS.filter((x) => x.tier === t).map((x) => {
              const done = w.hasTech(x.id);
              const avail = x.prereq.every((p) => w.hasTech(p));
              return (
                <button key={x.id} className={`tech ${done ? 'done' : r.current === x.id ? 'cur' : !avail ? 'locked' : ''}`} disabled={done || !avail} onClick={() => w.setResearch(x.id)}>
                  <div className="row"><b className="small">{x.name}</b><span className="spacer" /><span className="tiny muted">{done ? '✔' : `${x.cost} pts`}</span></div>
                  <div className="tiny muted">{x.desc}</div>
                  {!avail && <div className="tiny warn">needs {x.prereq.filter((p) => !w.hasTech(p)).map((p) => TECH_MAP[p].name).join(', ')}</div>}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ objectives

function ObjectivesPanel() {
  const w = useWorld(800)!;
  const m = w.lastMonth();
  const st = w.state;
  const milestones = [100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000];
  return (
    <div className="col" style={{ gap: 10 }}>
      {st.scenarioComplete && <div className="card good">Scenario complete! Every objective is met. The game goes on: keep growing, and try the milestones below.</div>}
      {w.scenario.objectives.map((o) => {
        const done = st.objectives[o.id] != null;
        const p = done ? 1 : Math.min(1, objectiveProgress(w, o, m));
        return (
          <div key={o.id} className="card">
            <div className="row small"><b>{done ? '✔ ' : ''}{o.text}</b><span className="spacer" />{o.reward ? <span className="chip">{money(o.reward)} grant</span> : null}</div>
            <Bar v={p} color={done ? 'var(--good)' : 'var(--accent)'} />
          </div>
        );
      })}
      <h3>Open-ended milestones</h3>
      <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
        {milestones.map((n) => (
          <span key={n} className={`chip ${st.stats.peakPop >= n ? 'good' : 'dim'}`}>{int(n)} residents</span>
        ))}
      </div>
      <div className="kv small">
        <span>Buildings completed</span><span>{st.stats.builtCount}</span>
        <span>Disasters weathered</span><span>{st.stats.disasterCount}</span>
        <span>Research completed</span><span>{st.research.completed.length}</span>
        <span>Trade deals</span><span>{st.countries.filter((c) => c.tradeDeal).length}</span>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ port planner

function PortsPanel() {
  const w = useWorld(1500)!;
  const focus = useApp((s) => s.portFocus);
  const sites = useMemo(() => findPortCandidates(w, focus, 6), [w, focus, w.structureVersion]);
  const ports = w.ports();
  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="small muted">The planner scans your coastline: shelter from the prevailing swell (from {w.scenario.climate.windDir.map((v, i) => [v, i] as const).sort((a, b) => b[0] - a[0]).slice(0, 2).map(([, i]) => ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][i]).join('/')}), water depth, shore slope, flat land for warehouses, construction cost and environmental sensitivity. Click any coast to analyse a spot yourself.</div>
      <div className="row small" style={{ flexWrap: 'wrap', gap: 4 }}>
        <span>Plan for:</span>
        {['small_harbour', 'marina', 'commercial_port', 'cruise_terminal', 'container_port', 'deepwater_port'].map((t) => (
          <button key={t} className={`btn sm ${focus === t ? 'on' : ''}`} disabled={!w.isUnlocked(BUILDING_MAP[t])} onClick={() => store.set({ portFocus: t })}>{BUILDING_MAP[t].name}</button>
        ))}
      </div>
      {ports.length > 0 && (
        <div className="card small">
          <b>Your ports</b>
          {ports.map((p) => (
            <div key={p.id} className="row">
              <a href="#" onClick={(e) => (e.preventDefault(), store.set({ selection: { kind: 'building', id: p.id } }), store.focus(p.x, p.z, 400))}>{BUILDING_MAP[p.type].name}</a>
              <span className="spacer" />
              <span className="muted">{p.status === 'construction' ? `building ${Math.round(p.progress * 100)}%` : `depth ${(p.depth ?? 0).toFixed(1)} m, shelter ${Math.round((p.shelter ?? 0) * 100)}%`}</span>
            </div>
          ))}
        </div>
      )}
      <b className="small">Best candidate sites (numbered on the map)</b>
      {sites.map((s, i) => (
        <div key={i}>
          <div className="tiny muted">#{i + 1}</div>
          <SiteCard world={w} s={s} />
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ geo data (developer panel)

function GeoPanel() {
  const w = useApp((s) => s.world)!;
  const settings = useApp((s) => s.settings);
  const meta = w.terrain.meta;
  const src = meta.sources ?? {};
  const [, tick] = useState(0);
  useEffect(() => {
    const h = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(h);
  }, []);
  const gl = renderRefs.gl;
  const info = gl?.info;
  return (
    <div className="col" style={{ gap: 12 }}>
      {meta.fallback && <div className="card bad">FALLBACK TERRAIN: {meta.fallback}</div>}
      <div className="kv small">
        <span>Location</span><span>{meta.name}, {meta.country}</span>
        <span>Centre</span><span>{meta.center[0].toFixed(4)}, {meta.center[1].toFixed(4)}</span>
        <span>Bounding box</span><span>{meta.bbox.map((v) => v.toFixed(3)).join(', ')}</span>
        <span>Grid</span><span>{meta.width} × {meta.height} cells</span>
        <span>Real cell size</span><span>{meta.cellReal.toFixed(1)} m</span>
        <span>Horizontal scale</span><span>×{meta.hscale} (game cell {w.terrain.cell.toFixed(1)} m)</span>
        <span>Vertical scale</span><span>×{meta.vscale}</span>
        <span>Vertical exaggeration (slopes)</span><span>×{meta.verticalExaggeration} (economics are not scaled)</span>
        <span>Real area of the island</span><span>{meta.stats.osmIslandKm2} km² (grid {meta.stats.territoryKm2} km²)</span>
        <span>Highest point</span><span>{meta.stats.maxElevation} m</span>
        <span>Deepest water in view</span><span>{-meta.stats.minDepth} m</span>
        <span>Flat land (&lt; 6°)</span><span>{meta.stats.flatTerritoryPct}%</span>
        <span>DEM cells missing (filled)</span><span>{meta.stats.demMissingPct}%</span>
        <span>Land cells approximated</span><span>{meta.stats.landApproxPct}%</span>
        <span>Sea cells approximated</span><span>{meta.stats.seaApproxPct}%</span>
        <span>OSM buildings in area</span><span>{meta.stats.osmBuildings}</span>
      </div>
      <h3>Sources & licences</h3>
      {Object.entries(src).map(([k, v]: [string, any]) => (
        <div key={k} className="card small col" style={{ gap: 3 }}>
          <b>{k === 'dem' ? 'Elevation' : k === 'bathymetry' ? 'Bathymetry' : 'Coastline'}: {v.name}</b>
          {v.resolution_m && <span className="muted">Native resolution about {v.resolution_m} m</span>}
          {v.tiles && <span className="muted tiny">Tiles: {v.tiles.join(', ')}</span>}
          {v.method && <span className="tiny">{v.method}</span>}
          {v.note && <span className="tiny">{v.note}</span>}
          <span className="tiny">Licence: {v.licence}</span>
          <span className="tiny muted">{v.attribution}</span>
          {v.url && <a className="tiny" href={v.url} target="_blank" rel="noreferrer">{v.url}</a>}
        </div>
      ))}
      <h3>Approximations</h3>
      <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
        {meta.approximations.map((a, i) => <li key={i}>{a}</li>)}
      </ul>
      <h3>Renderer</h3>
      <div className="kv small">
        <span>Quality preset</span><span>{settings.quality}</span>
        <span>Pixel ratio</span><span>{gl ? gl.getPixelRatio().toFixed(2) : '–'}</span>
        <span>Shadow map</span><span>{settings.shadows}</span>
        <span>Terrain detail</span><span>{settings.terrainDetail}</span>
        <span>Triangles last frame</span><span>{info ? int(info.render.triangles) : '–'}</span>
        <span>Draw calls</span><span>{info ? info.render.calls : '–'}</span>
        <span>Trees & shrubs</span><span>{int(renderRefs.vegetationCount)}</span>
        <span>Frame rate</span><span>{renderRefs.fps.toFixed(0)} fps</span>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ help & log

function HelpPanel() {
  return (
    <div className="col small" style={{ gap: 10, lineHeight: 1.5 }}>
      <p>Nationforge is a nation-building game on real islands. The terrain, coastline and seabed come from real data (see the Geo data panel). Everything else is a fictional scenario.</p>
      <h3>The core loop</h3>
      <ol style={{ margin: 0, paddingLeft: 18 }}>
        <li>Inspect the terrain: click the ground, try the slope and buildable overlays.</li>
        <li>Compare port sites in the Port planner and build a harbour or port. Add breakwaters, dredging, quays, customs and links from its panel.</li>
        <li>Build roads: they follow contours within a grade limit.</li>
        <li>Place homes, jobs, power and water near roads; paint zones so private investors build too.</li>
        <li>Residents move in when there are vacant homes, jobs, decent wages, services and utilities.</li>
        <li>Each month the economy updates: GDP, wages, rents, inflation, trade, taxes, debt. Panels explain what changed and why.</li>
        <li>Set taxes, budgets and policies; deal with events and disasters; trade and negotiate with fictional countries; research new technology.</li>
      </ol>
      <h3>Controls</h3>
      <div className="kv">
        <span>Pan</span><span>drag / WASD / arrows</span>
        <span>Rotate & tilt</span><span>right-drag / Q, E</span>
        <span>Zoom</span><span>wheel / Z, X</span>
        <span>Pause / speed</span><span>Space / 1–4</span>
        <span>Rotate building</span><span>R</span>
        <span>Cancel</span><span>Esc / right-click</span>
        <span>Walk</span><span>🚶 button, then WASD, Shift, Space; M or Esc to leave</span>
        <span>Save</span><span>Ctrl+S</span>
      </div>
    </div>
  );
}

function LogPanel() {
  const w = useWorld(800)!;
  const m = w.lastMonth();
  const c = w.scenario.climate;
  return (
    <div className="col" style={{ gap: 12 }}>
      {m && <Explain items={m.explain} />}
      <b className="small">Climate of {w.scenario.name}</b>
      <table className="t tiny">
        <thead><tr><th /> {MONTH_SHORT.map((x) => <th key={x} className="r">{x}</th>)}</tr></thead>
        <tbody>
          <tr><td>°C</td>{c.temp.map((v, i) => <td key={i} className="r">{v}</td>)}</tr>
          <tr><td>wet days</td>{c.rain.map((v, i) => <td key={i} className="r">{Math.round(v * 30)}</td>)}</tr>
          <tr><td>wind m/s</td>{c.wind.map((v, i) => <td key={i} className="r">{v}</td>)}</tr>
          <tr><td>tourism</td>{w.scenario.tourismSeason.map((v, i) => <td key={i} className="r">{v.toFixed(1)}</td>)}</tr>
        </tbody>
      </table>
      <div className="tiny muted">Rain and wind delay construction, storms close ports and keep fishing boats in, fog slows shipping, wind drives turbines, sunshine drives solar, rainfall fills cisterns and reservoirs.</div>
      <b className="small">All notifications</b>
      {w.state.notifications.map((n) => (
        <div key={n.id} className={`note k-${n.kind}`}><b className="small">{n.title}</b>{n.text && <div className="tiny muted">{n.text}</div>}</div>
      ))}
    </div>
  );
}
