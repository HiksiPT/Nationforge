// Fictional foreign countries, generated from the game seed, and the diplomatic actions available.

import { RESOURCES, type ResId } from '../data/catalogue';
import { clamp } from './economy';
import { Rng } from './rng';
import type { Country, FlagSpec } from './types';
import type { World } from './world';
import { money } from './world';

const START = ['Val', 'Mor', 'Ast', 'Kel', 'Ser', 'Tor', 'Ul', 'Bra', 'Cyr', 'Dor', 'Ely', 'Fen', 'Gal', 'Hal', 'Ist', 'Jor', 'Kav', 'Lum', 'Nor', 'Os', 'Pel', 'Quor', 'Ryn', 'Sal', 'Tav', 'Vel', 'Wes', 'Zan'];
const MID = ['a', 'e', 'i', 'o', 'ar', 'en', 'or', 'ul', 'an', 'is', 'ad', 'em'];
const END = ['ria', 'land', 'via', 'ora', 'stan', 'mark', 'esia', 'onia', 'heim', 'garde', 'ica', 'ana', 'eth', 'avia'];
const PALETTE = ['#1f4e8c', '#c8102e', '#f2c230', '#2e8b57', '#ffffff', '#111111', '#e46b1a', '#5b2a86', '#38a8d8', '#8b1e3f', '#6aa84f'];

export function makeFlag(rng: Rng): FlagSpec {
  const patterns: FlagSpec['pattern'][] = ['tricolour-v', 'tricolour-h', 'cross', 'canton', 'diagonal', 'circle', 'chevron'];
  const emblems: FlagSpec['emblem'][] = ['none', 'none', 'star', 'sun', 'wave', 'mountain', 'fish'];
  const cols = [...PALETTE];
  const pick = () => cols.splice(Math.floor(rng.next() * cols.length), 1)[0];
  return { pattern: rng.pick(patterns), colors: [pick(), pick(), pick()], emblem: rng.pick(emblems) };
}

export function generateCountries(seed: number, scenario: string): Country[] {
  const rng = new Rng(seed ^ 0x5bd1e995);
  const used = new Set<string>();
  const traitsPool: Country['traits'][number][] = ['eco', 'trade', 'tourism', 'investor', 'protectionist'];
  const resIds = Object.keys(RESOURCES) as ResId[];
  const out: Country[] = [];
  for (let i = 0; i < 6; i++) {
    let name = '';
    while (!name || used.has(name)) name = rng.pick(START) + (rng.chance(0.5) ? rng.pick(MID) : '') + rng.pick(END);
    used.add(name);
    const traits = new Set<Country['traits'][number]>();
    traits.add(rng.pick(traitsPool));
    if (rng.chance(0.6)) traits.add(rng.pick(traitsPool));
    const adjective = name.replace(/(ia|a|land|stan|mark|heim|garde|eth)$/, '') + (name.endsWith('land') ? 'ish' : 'ian');
    out.push({
      id: `c${i}`,
      name,
      adjective,
      flag: makeFlag(rng),
      gdp: Math.round(rng.range(0.4, 2.6) * 10) / 10,
      distance: Math.round(rng.range(0.1, 1) * 100) / 100,
      relation: Math.round(rng.range(-10, 35)),
      traits: [...traits],
      tradeDeal: false,
      theirTariff: traits.has('protectionist') ? 0.14 : Math.round(rng.range(0.03, 0.1) * 100) / 100,
      tourismShare: 0,
      investment: 0,
      campaign: 0,
      lastAction: -999,
      wants: [rng.pick(resIds), rng.pick(resIds)],
    });
  }
  // tourism shares: closer, bigger, tourism-minded countries send more visitors
  const raw = out.map((c) => c.gdp * (1.2 - c.distance) * (c.traits.includes('tourism') ? 1.6 : 1));
  const tot = raw.reduce((s, v) => s + v, 0);
  out.forEach((c, i) => (c.tourismShare = raw[i] / tot));
  void scenario;
  return out;
}

export type DiploAction = 'trade_deal' | 'cancel_deal' | 'tourism_campaign' | 'investment_mission' | 'cultural_exchange' | 'aid';

export const DIPLO_ACTIONS: Record<DiploAction, { name: string; desc: string; cost: (w: World, c: Country) => number; minRelation?: number; cooldown: number }> = {
  trade_deal: { name: 'Propose trade deal', desc: 'Mutual zero tariffs: your exports sell at full price there, their goods enter tariff-free (less tariff revenue).', cost: () => 0, minRelation: 20, cooldown: 90 },
  cancel_deal: { name: 'Cancel trade deal', desc: 'Restores tariffs both ways. Hurts relations.', cost: () => 0, cooldown: 30 },
  tourism_campaign: { name: 'Tourism campaign', desc: 'Six months of advertising: more visitors from this country.', cost: (w, c) => Math.round((250_000 + 400_000 * c.gdp) * w.state.priceIndex), cooldown: 60 },
  investment_mission: { name: 'Investment mission', desc: 'A delegation of investors: a burst of foreign investment if relations and stability are good.', cost: (w) => Math.round(400_000 * w.state.priceIndex), minRelation: 0, cooldown: 120 },
  cultural_exchange: { name: 'Cultural exchange', desc: 'Students, artists and sport: +12 relations.', cost: (w) => Math.round(150_000 * w.state.priceIndex), cooldown: 60 },
  aid: { name: 'Disaster aid offer', desc: 'Offer help to a partner: +20 relations, +reputation.', cost: (w) => Math.round(600_000 * w.state.priceIndex), cooldown: 180 },
};

export function diplomacyAction(w: World, id: string, action: DiploAction): { ok: boolean; msg: string } {
  const st = w.state;
  const c = st.countries.find((x) => x.id === id);
  if (!c) return { ok: false, msg: 'Unknown country' };
  const a = DIPLO_ACTIONS[action];
  if (st.day - c.lastAction < a.cooldown) return { ok: false, msg: `Wait ${a.cooldown - (st.day - c.lastAction)} more days` };
  if (a.minRelation != null && c.relation < a.minRelation) return { ok: false, msg: `Relations must be at least ${a.minRelation}` };
  const cost = a.cost(w, c);
  if (cost > st.treasury) return { ok: false, msg: 'Not enough money' };
  st.treasury -= cost;
  c.lastAction = st.day;
  let msg = '';
  switch (action) {
    case 'trade_deal': {
      const p = clamp(0.35 + c.relation / 120 + (c.traits.includes('trade') ? 0.25 : 0) - (c.traits.includes('protectionist') ? 0.3 : 0), 0.05, 0.95);
      if (c.tradeDeal) return { ok: false, msg: 'Already have a deal' };
      if (w.rng.chance(p)) {
        c.tradeDeal = true;
        c.relation = clamp(c.relation + 8, -100, 100);
        msg = `${c.name} signed a free-trade agreement.`;
        w.notify('good', 'Trade deal signed', msg);
      } else {
        c.relation = clamp(c.relation - 3, -100, 100);
        msg = `${c.name} declined for now (chance was ${Math.round(p * 100)}%).`;
        w.notify('warn', 'Trade deal declined', msg);
      }
      break;
    }
    case 'cancel_deal':
      c.tradeDeal = false;
      c.relation = clamp(c.relation - 20, -100, 100);
      msg = `Trade deal with ${c.name} cancelled.`;
      w.notify('warn', 'Trade deal cancelled', msg);
      break;
    case 'tourism_campaign':
      c.campaign = 6;
      msg = `Tourism campaign running in ${c.name} for six months (${money(cost)}).`;
      w.notify('info', 'Tourism campaign launched', msg);
      break;
    case 'investment_mission': {
      const amount = Math.round((1_500_000 + 3_000_000 * c.gdp * (c.traits.includes('investor') ? 1.8 : 1)) * clamp((c.relation + 40) / 100, 0.1, 1.3) * clamp(st.stability + 0.2, 0.2, 1.2));
      c.investment += amount;
      st.modifiers.push({ id: 'fdi_mission', label: `${c.adjective} investors`, target: 'fdi', value: amount, until: st.day + 1 });
      c.relation = clamp(c.relation + 3, -100, 100);
      msg = `${c.adjective} investors committed ${money(amount)} to island businesses.`;
      w.notify('good', 'Investment mission', msg);
      break;
    }
    case 'cultural_exchange':
      c.relation = clamp(c.relation + 12, -100, 100);
      msg = `Relations with ${c.name} improved.`;
      w.notify('good', 'Cultural exchange', msg);
      break;
    case 'aid':
      c.relation = clamp(c.relation + 20, -100, 100);
      st.reputation = clamp(st.reputation + 3, 0, 100);
      msg = `${c.name} thanked you for your help.`;
      w.notify('good', 'Aid delivered', msg);
      break;
  }
  w.emit();
  return { ok: true, msg };
}

/** Monthly drift of relations, driven by tariffs, environment, deals and reputation. */
export function updateRelations(w: World) {
  const st = w.state;
  for (const c of st.countries) {
    let target = 10 + st.reputation * 0.25;
    if (c.tradeDeal) target += 15;
    if (c.traits.includes('trade') || c.traits.includes('protectionist')) target -= st.policy.tariff * 120;
    if (c.traits.includes('eco')) target += (st.env.quality - 60) * 0.5;
    if (c.traits.includes('tourism')) target += c.campaign > 0 ? 6 : 0;
    c.relation = clamp(c.relation + (target - c.relation) * 0.06, -100, 100);
    if (c.campaign > 0) c.campaign--;
    if (!c.tradeDeal) c.theirTariff = clamp(c.theirTariff + (st.policy.tariff > 0.15 ? 0.002 : -0.001), 0, 0.3);
  }
}

/** Average export price factor after foreign tariffs (trade deals remove them). */
export function exportPriceFactor(w: World, res: ResId): number {
  let f = 0, tw = 0;
  for (const c of w.state.countries) {
    const weight = c.gdp * (c.wants.includes(res) ? 1.6 : 1);
    const tariff = c.tradeDeal ? 0 : c.theirTariff;
    const rel = 1 + clamp(c.relation, -50, 50) / 500;
    f += weight * (1 - tariff) * rel * (c.wants.includes(res) ? 1.08 : 1);
    tw += weight;
  }
  return tw > 0 ? f / tw : 1;
}

/** Share of imports that pay the island's tariff (partners with deals pay none). */
export function tariffableShare(w: World): number {
  let a = 0, t = 0;
  for (const c of w.state.countries) {
    t += c.gdp;
    if (!c.tradeDeal) a += c.gdp;
  }
  return t > 0 ? a / t : 1;
}

export function tourismRelationFactor(w: World): number {
  let f = 0;
  for (const c of w.state.countries) f += c.tourismShare * (1 + clamp(c.relation, -60, 60) / 200 + (c.campaign > 0 ? 0.35 : 0));
  return f;
}
