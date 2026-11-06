// Political and economic events with choices, and natural disasters.

import type { DisasterKind } from '../data/scenarios';
import { clamp } from './economy';
import type { Building, PendingEvent } from './types';
import { money, type World } from './world';

interface EventDef {
  id: string;
  weight: (w: World) => number; // 0 = cannot happen now
  make: (w: World) => { title: string; text: string; data?: Record<string, any> };
  choices: { label: string; desc: (w: World, e: PendingEvent) => string; apply: (w: World, e: PendingEvent) => void }[];
}

const mod = (w: World, id: string, label: string, target: any, value: number, months: number) =>
  w.state.modifiers.push({ id, label, target, value, until: w.state.day + months * 30 });

export const EVENTS: EventDef[] = [
  {
    id: 'investor_resort',
    weight: (w) => (w.state.reputation > 35 && w.maxPortTier() >= 1 ? 1 : 0),
    make: (w) => ({ title: 'Resort developer comes calling', text: `A hotel group offers to build and run a hotel on the island at its own cost, in return for a 5-year tax holiday. Unions welcome the jobs; ${w.scenario.envWeight > 1.3 ? 'conservationists are worried.' : 'some residents fear overdevelopment.'}` }),
    choices: [
      { label: 'Accept', desc: () => 'A private hotel is built near the coast. -3 environment, +jobs, lower corporate tax take for 5 years.', apply: (w) => { autoPlacePrivate(w, 'hotel'); w.state.env.quality -= 3; mod(w, 'tax_holiday', 'Hotel tax holiday', 'fdi', -50_000, 60); } },
      { label: 'Ask for an eco-lodge instead', desc: () => '50% chance they agree to a smaller, greener lodge; otherwise they walk away.', apply: (w) => { if (w.rng.chance(0.5)) { autoPlacePrivate(w, 'ecolodge'); w.notify('good', 'Eco-lodge agreed'); } else w.notify('info', 'The developer walked away'); } },
      { label: 'Decline', desc: () => '+2 approval among residents who value the island as it is.', apply: (w) => mod(w, 'declined_resort', 'Kept the coast wild', 'approval', 2, 6) },
    ],
  },
  {
    id: 'housing_protest',
    weight: (w) => ((w.lastMonth()?.rentIndex ?? 1) > 1.5 ? 2 : 0),
    make: () => ({ title: 'Rent protest', text: 'Young families march on the town hall: rents have outrun wages and people are leaving the island.' }),
    choices: [
      { label: 'Introduce rent control', desc: () => 'Caps rents. Private landlords build fewer homes.', apply: (w) => { w.setPolicy({ housing: 'rent_control' }); mod(w, 'rc', 'Rent control welcomed', 'approval', 5, 6); } },
      { label: 'Fund social housing', desc: (w) => `Spend ${money(3_000_000 * w.state.priceIndex)} on a social housing grant (+approval).`, apply: (w) => { w.state.treasury -= 3_000_000 * w.state.priceIndex; mod(w, 'sh', 'Social housing grant', 'approval', 6, 8); w.setPolicy({ housing: 'social' }); } },
      { label: 'Let the market work', desc: () => '-6 approval for a while; zones will keep building.', apply: (w) => mod(w, 'ignored', 'Ignored rent protest', 'approval', -6, 6) },
    ],
  },
  {
    id: 'ferry_strike',
    weight: (w) => (w.state.pop > 50 ? 0.6 : 0),
    make: () => ({ title: 'Ferry crews strike', text: 'Ferry and cargo crews walk out over pay. Imports and tourists are stuck on the mainland.' }),
    choices: [
      { label: 'Meet their demands', desc: (w) => `Pay ${money(400_000 * w.state.priceIndex)}; the strike ends at once.`, apply: (w) => { w.state.treasury -= 400_000 * w.state.priceIndex; } },
      { label: 'Wait it out', desc: () => 'Trade capacity halves for a month; -4 approval.', apply: (w) => { mod(w, 'strike', 'Ferry strike', 'approval', -4, 1); w.state.disasters.push({ kind: 'storm', start: w.state.day, days: 20, severity: 0.4 }); } },
    ],
  },
  {
    id: 'heritage_grant',
    weight: (w) => (w.scenario.landmark && !w.state.buildings.some((b) => b.type === 'heritage_restoration') ? 0.7 : 0),
    make: (w) => ({ title: 'Heritage fund offers a grant', text: `An international heritage foundation will pay part of the restoration of ${w.scenario.landmark!.name} if you commit to it.` }),
    choices: [
      { label: 'Accept the grant', desc: (w) => `Receive ${money(3_000_000)} now. Restoration is expected within 3 years.`, apply: (w) => { w.state.treasury += 3_000_000; mod(w, 'heritage_promise', 'Heritage promise', 'approval', 2, 12); } },
      { label: 'Decline', desc: () => 'No strings attached.', apply: () => {} },
    ],
  },
  {
    id: 'fishing_quota',
    weight: (w) => (w.state.buildings.filter((b) => b.type === 'fishing_fleet').length >= 1 && w.state.env.marine < 70 ? 1.2 : 0),
    make: () => ({ title: 'Fish stocks are falling', text: 'Marine scientists warn that catches are unsustainable. Fishers fear for their livelihoods.' }),
    choices: [
      { label: 'Set strict quotas', desc: () => 'Fishing output -30% for a year; marine health recovers faster.', apply: (w) => { mod(w, 'quota', 'Fishing quotas', 'marine', 6, 12); mod(w, 'quota_prod', 'Fishing quotas', 'productivity', -0.02, 12); } },
      { label: 'Keep fishing', desc: () => 'Marine health keeps falling; eco-minded partners notice.', apply: (w) => { w.state.env.marine -= 4; w.state.reputation -= 3; } },
    ],
  },
  {
    id: 'tech_startup',
    weight: (w) => (w.state.pop > 300 && w.state.buildings.some((b) => b.type === 'telecom_mast') ? 0.6 : 0),
    make: () => ({ title: 'Remote workers discover the island', text: 'A travel article calls the island "the best office view in the world". Remote workers want to move in.' }),
    choices: [
      { label: 'Welcome them', desc: () => 'A wave of high-earning newcomers; rents rise.', apply: (w) => mod(w, 'nomads', 'Remote-worker boom', 'migration', 0.15, 6) },
      { label: 'Prioritise locals for housing', desc: () => '+3 approval; fewer newcomers.', apply: (w) => mod(w, 'locals', 'Locals first', 'approval', 3, 6) },
    ],
  },
  {
    id: 'cruise_offer',
    weight: (w) => (w.state.buildings.some((b) => b.type === 'cruise_terminal' && b.status === 'active') ? 0.8 : 0),
    make: () => ({ title: 'Cruise line wants more calls', text: 'A cruise line offers to double its calls if you cut port fees.' }),
    choices: [
      { label: 'Agree', desc: () => '+40% cruise visitors for a year, more pressure on the coast.', apply: (w) => { mod(w, 'cruise', 'Extra cruise calls', 'tourism', 0.15, 12); w.state.env.marine -= 2; } },
      { label: 'Cap cruise visits', desc: () => '+2 environment, +2 approval.', apply: (w) => { w.state.env.quality += 2; mod(w, 'cap', 'Cruise cap', 'approval', 2, 12); } },
    ],
  },
  {
    id: 'diaspora',
    weight: (w) => ((w.lastMonth()?.unemployment ?? 0) < 0.05 && w.state.pop > 100 ? 0.8 : 0),
    make: () => ({ title: 'Islanders want to come home', text: 'People who left for jobs on the mainland ask for help to move back.' }),
    choices: [
      { label: 'Fund a return programme', desc: (w) => `${money(500_000 * w.state.priceIndex)}; more migrants for six months.`, apply: (w) => { w.state.treasury -= 500_000 * w.state.priceIndex; mod(w, 'return', 'Return programme', 'migration', 0.2, 6); } },
      { label: 'Not now', desc: () => 'Nothing changes.', apply: () => {} },
    ],
  },
  {
    id: 'energy_price',
    weight: (w) => (w.state.buildings.some((b) => b.type === 'diesel_generator' && b.status === 'active') ? 0.6 : 0),
    make: () => ({ title: 'Oil prices spike', text: 'World fuel prices jump 40%. Diesel power and transport costs will follow.' }),
    choices: [
      { label: 'Subsidise fuel', desc: (w) => `${money(800_000 * w.state.priceIndex)} to shield households.`, apply: (w) => { w.state.treasury -= 800_000 * w.state.priceIndex; } },
      { label: 'Pass it on', desc: () => '+1.5% prices, -4 approval.', apply: (w) => { w.state.priceIndex *= 1.015; mod(w, 'fuel', 'Fuel price spike', 'approval', -4, 4); } },
    ],
  },
  {
    id: 'scientists',
    weight: (w) => (w.scenario.envWeight > 1.3 ? 0.6 : 0.25),
    make: (w) => ({ title: 'Research expedition', text: `A university wants to base a field team on ${w.scenario.name} to study its ${w.scenario.id === 'moorea' ? 'reef' : 'wildlife'}.` }),
    choices: [
      { label: 'Host them', desc: () => '+25 research points, +3 reputation.', apply: (w) => { w.state.research.progress += 25; w.state.reputation += 3; } },
      { label: 'Charge a permit fee', desc: () => '+$250k.', apply: (w) => { w.state.treasury += 250_000; } },
    ],
  },
];

export function maybeTriggerEvent(w: World) {
  if (w.state.pendingEvents.length >= 2) return;
  if (!w.rng.chance(0.28)) return;
  const recent = new Set(w.state.eventLog.filter((e) => w.state.day - e.day < 360).map((e) => e.title));
  const pool = EVENTS.filter((e) => e.weight(w) > 0);
  const def = w.rng.weighted(pool, (e) => e.weight(w));
  if (!def) return;
  const m = def.make(w);
  if (recent.has(m.title)) return;
  const pe: PendingEvent = { id: def.id, uid: w.state.nextNote++, day: w.state.day, title: m.title, text: m.text, choices: def.choices.map((c) => ({ label: c.label, desc: '' })), data: m.data };
  pe.choices = def.choices.map((c) => ({ label: c.label, desc: c.desc(w, pe) }));
  w.state.pendingEvents.push(pe);
  w.notify('event', m.title, 'A decision is waiting for you.');
}

export function resolveEvent(w: World, uid: number, choice: number) {
  const st = w.state;
  const e = st.pendingEvents.find((x) => x.uid === uid);
  if (!e) return;
  const def = EVENTS.find((d) => d.id === e.id);
  const c = def?.choices[choice];
  if (c) c.apply(w, e);
  st.pendingEvents = st.pendingEvents.filter((x) => x.uid !== uid);
  st.eventLog.unshift({ day: st.day, title: e.title, choice: c?.label ?? '' });
  if (st.eventLog.length > 60) st.eventLog.length = 60;
  st.env.quality = clamp(st.env.quality, 0, 100);
  st.env.marine = clamp(st.env.marine, 0, 100);
  st.reputation = clamp(st.reputation, 0, 100);
  w.emit(true);
}

/** Put a privately funded building on the best zoned or coastal spot available. */
export function autoPlacePrivate(w: World, type: string): Building | null {
  const t = w.terrain;
  let best: [number, number] | null = null;
  let bs = -1;
  for (let k = 0; k < 400; k++) {
    const i = w.rng.int(2, t.W - 3), j = w.rng.int(2, t.H - 3);
    const [x, z] = t.toWorld(i, j);
    if (!t.isTerritory(x, z)) continue;
    const r = w.evaluate(type, x, z, w.rng.range(0, Math.PI));
    if (!r.errors.filter((e) => !e.startsWith('Costs')).length) {
      const s = r.suitability + (r.checks.find((c) => c.label === 'Road access')?.state === 'ok' ? 40 : 0);
      if (s > bs) (bs = s), (best = [x, z]);
    }
  }
  if (!best) return null;
  const res = w.placeBuilding(type, best[0], best[1], 0, { free: true, owner: 'private' });
  return res.building ?? null;
}

// ------------------------------------------------------------ disasters

export const DISASTER_INFO: Record<DisasterKind, { name: string; icon: string; days: [number, number] }> = {
  storm: { name: 'Severe gale', icon: '\u{1F32A}', days: [2, 4] },
  cyclone: { name: 'Tropical cyclone', icon: '\u{1F300}', days: [3, 5] },
  drought: { name: 'Drought', icon: '☀', days: [45, 90] },
  wildfire: { name: 'Wildfire', icon: '\u{1F525}', days: [4, 9] },
  earthquake: { name: 'Earthquake', icon: '〰', days: [1, 1] },
  landslide: { name: 'Landslide', icon: '⛰', days: [1, 2] },
  bleaching: { name: 'Coral bleaching', icon: '\u{1FAB8}', days: [40, 80] },
  algal_bloom: { name: 'Harmful algal bloom', icon: '\u{1F9A0}', days: [20, 40] },
};

export function rollDisasters(w: World) {
  const st = w.state;
  const month = w.month();
  for (const d of w.scenario.disasters) {
    if (st.disasters.some((x) => x.kind === d.kind)) continue;
    const p = (d.p * (d.season ? d.season[month] : 1)) / 30;
    if (!w.rng.chance(p)) continue;
    startDisaster(w, d.kind, 0.4 + w.rng.next() * 0.6);
  }
}

export function startDisaster(w: World, kind: DisasterKind, severity: number) {
  const st = w.state;
  const info = DISASTER_INFO[kind];
  const t = w.terrain;
  let at: [number, number] | undefined;
  let radius: number | undefined;
  // pick a land point for local disasters
  if (kind === 'wildfire' || kind === 'landslide') {
    for (let k = 0; k < 200; k++) {
      const [x, z] = t.toWorld(w.rng.int(0, t.W - 1), w.rng.int(0, t.H - 1));
      if (!t.isTerritory(x, z)) continue;
      if (kind === 'landslide' && t.slopeAt(x, z) < 18) continue;
      at = [x, z];
      radius = kind === 'wildfire' ? 500 + severity * 900 : 250 + severity * 250;
      break;
    }
    if (!at) return;
  }
  const days = Math.round(info.days[0] + (info.days[1] - info.days[0]) * w.rng.next());
  st.disasters.push({ kind, start: st.day, days, severity, at, radius });
  st.stats.disasterCount++;
  const resist = 1 - w.techBonus('disaster');
  let damaged = 0;
  const damage = (b: Building, amount: number) => {
    const before = b.condition;
    b.condition = clamp(b.condition - amount * resist, 0.05, 1);
    if (b.condition < 0.6 && b.status === 'active') b.status = 'damaged';
    if (before - b.condition > 0.05) damaged++;
  };
  const fireCover = (x: number, z: number) => st.buildings.some((b) => b.type === 'fire_station' && b.status === 'active' && Math.hypot(b.x - x, b.z - z) < 1800);
  switch (kind) {
    case 'storm':
    case 'cyclone': {
      const strength = kind === 'cyclone' ? 0.55 : 0.25;
      for (const b of st.buildings) {
        const coastal = t.coastDistAt(b.x, b.z) < 250 || w.def(b).site === 'sea' || !!w.def(b).port;
        const shelter = w.def(b).port ? (b.shelter ?? 0.5) : 0.5;
        if (coastal && w.rng.chance(0.5 + severity * 0.4)) damage(b, strength * severity * (1.2 - shelter));
        else if (kind === 'cyclone' && w.rng.chance(0.3)) damage(b, 0.15 * severity);
      }
      if (kind === 'cyclone') st.env.marine -= 6 * severity;
      break;
    }
    case 'earthquake':
      for (const b of st.buildings) if (w.rng.chance(0.35)) damage(b, 0.35 * severity);
      break;
    case 'wildfire': {
      for (const b of st.buildings) {
        if (Math.hypot(b.x - at![0], b.z - at![1]) < radius!) damage(b, (fireCover(b.x, b.z) ? 0.15 : 0.6) * severity);
      }
      // burn vegetation
      const [cx, cy] = t.toGrid(at![0], at![1]);
      const rc = radius! / t.cell;
      for (let j = Math.floor(cy - rc); j <= cy + rc; j++) for (let i = Math.floor(cx - rc); i <= cx + rc; i++) {
        if (i < 0 || j < 0 || i >= t.W || j >= t.H || (i - cx) ** 2 + (j - cy) ** 2 > rc * rc) continue;
        if (w.rng.chance(0.7)) st.cleared[j * t.W + i] = 2;
      }
      w.vegetationVersion++;
      st.env.quality -= 4 * severity;
      break;
    }
    case 'landslide':
      for (const b of st.buildings) if (Math.hypot(b.x - at![0], b.z - at![1]) < radius!) damage(b, 0.7 * severity);
      for (const r of st.roads) if (r.pts.some((p) => Math.hypot(p[0] - at![0], p[1] - at![1]) < radius!)) r.progress = Math.min(r.progress, 0.6), (r.status = 'construction');
      break;
    case 'bleaching':
      st.env.marine -= 12 * severity * (st.env.quality > 70 ? 0.8 : 1);
      break;
    case 'algal_bloom':
      st.env.marine -= 4 * severity;
      break;
    case 'drought':
      break;
  }
  st.env.marine = clamp(st.env.marine, 0, 100);
  st.env.quality = clamp(st.env.quality, 0, 100);
  const extra = damaged ? ` ${damaged} building${damaged > 1 ? 's' : ''} damaged.` : '';
  const texts: Record<DisasterKind, string> = {
    storm: 'Gale-force winds and big seas. Ports close, construction stops, coastal buildings take a beating.',
    cyclone: 'A tropical cyclone sweeps past. Heavy damage along the coast and in the lagoon.',
    drought: 'Weeks without rain. Wells, cisterns and reservoirs are running low; farms suffer.',
    wildfire: 'Fire is racing through the dry scrub.',
    earthquake: 'The ground shook across the island.',
    landslide: 'Saturated slopes gave way after heavy rain. Roads are blocked.',
    bleaching: 'Warm water is bleaching the coral. Reef health and dive tourism will suffer.',
    algal_bloom: 'A toxic algal bloom: fish farms and fishing are closed until it clears.',
  };
  w.computeRoadComponents();
  w.notify('bad', info.name, texts[kind] + extra, at);
  w.emit(true);
}
