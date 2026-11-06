import { describe, expect, it } from 'vitest';
import { advanceDay } from '../src/sim/engine';
import { createGame } from '../src/sim/newgame';
import { findPortCandidates } from '../src/sim/port';
import { makeEnvelope, openEnvelope, SaveError, serializeState, deserializeState } from '../src/save/serialize';
import { World } from '../src/sim/world';
import { SCENARIOS } from '../src/data/scenarios';
import { MASK } from '../src/geo/terrain';
import { loadTerrain } from './helpers';
import { hashString } from '../src/sim/rng';

const FLAG = { pattern: 'tricolour-v', colors: ['#1f4e8c', '#ffffff', '#2e8b57'], emblem: 'none' } as const;

function newShuna(seed = 42) {
  return createGame(loadTerrain('shuna'), { scenario: 'shuna', nationName: 'Test Isle', flag: { ...FLAG, colors: [...FLAG.colors] }, seed });
}

function run(w: World, days: number) {
  for (let i = 0; i < days; i++) advanceDay(w);
}

/** Place a building near (x, z), searching outward for a valid spot. */
function placeSomewhere(w: World, type: string, x: number, z: number, rot = 0, maxR = 1500) {
  for (let r = 0; r <= maxR; r += 20) {
    for (let a = 0; a < 16; a++) {
      const px = x + Math.cos((a / 16) * Math.PI * 2) * r;
      const pz = z + Math.sin((a / 16) * Math.PI * 2) * r;
      const ev = w.evaluate(type, px, pz, rot);
      if (ev.ok) {
        const res = w.placeBuilding(type, px, pz, rot);
        if (res.ok) return res.building!;
      }
      if (r === 0) break;
    }
  }
  return null;
}

describe('real terrain packages', () => {
  for (const s of SCENARIOS) {
    it(`${s.id}: real DEM with territory, sea and plausible relief`, () => {
      const t = loadTerrain(s.id);
      let terr = 0, sea = 0;
      for (let k = 0; k < t.mask.length; k++) {
        if ((t.mask[k] & 3) === MASK.territory) terr++;
        if ((t.mask[k] & 3) === MASK.sea) sea++;
      }
      expect(terr).toBeGreaterThan(1000);
      expect(sea).toBeGreaterThan(1000);
      expect(t.meta.stats.maxElevation).toBeGreaterThan(50);
      expect(t.meta.sources.dem.name).toContain('Copernicus');
      // territory area matches the OSM island polygon within 12%
      expect(Math.abs(t.meta.stats.territoryKm2 / t.meta.stats.osmIslandKm2 - 1)).toBeLessThan(0.12);
      // slopes are preserved: vertical and horizontal scale differ by under 10%
      expect(Math.abs(t.vs / t.hs - 1)).toBeLessThan(0.1);
    });
  }
});

describe('core loop on Shuna', () => {
  it('starts with the estate, real tracks and a priced economy', () => {
    const w = newShuna();
    expect(w.state.pop).toBe(12);
    expect(w.state.buildings.length).toBeGreaterThanOrEqual(3);
    expect(w.state.roads.length).toBeGreaterThan(3);
    expect(w.state.history.length).toBe(1);
    expect(w.state.regions.length).toBe(3);
  });

  it('compares port sites and builds a harbour with costs deducted', () => {
    const w = newShuna();
    const sites = findPortCandidates(w, 'small_harbour', 6);
    expect(sites.length).toBeGreaterThanOrEqual(3);
    for (const s of sites) {
      expect(s.shelter).toBeGreaterThanOrEqual(0);
      expect(s.shelter).toBeLessThanOrEqual(1);
      expect(s.costs.length).toBe(6);
    }
    const best = sites[0];
    const before = w.state.treasury;
    const ev = w.evaluate('small_harbour', best.x, best.z, 0);
    expect(ev.snap).toBeDefined();
    const res = w.placeBuilding('small_harbour', best.x, best.z, 0);
    expect(res.ok, res.error).toBe(true);
    expect(w.state.treasury).toBeCloseTo(before - ev.cost, -2);
    expect(res.building!.status).toBe('construction');
    run(w, 200);
    expect(w.building(res.building!.id)!.status).toBe('active');
  });

  it('rejects invalid placements with reasons', () => {
    const w = newShuna();
    // in the sea
    const sea = w.evaluate('houses', -w.terrain.widthM / 2 + 200, 0, 0);
    expect(sea.ok).toBe(false);
    // on Luing (foreign land, west edge)
    let foreign: [number, number] | null = null;
    for (let i = 2; i < 60 && !foreign; i++) {
      for (let j = 100; j < 400; j += 7) {
        if ((w.terrain.mask[j * w.terrain.W + i] & 3) === MASK.foreign) {
          foreign = w.terrain.toWorld(i, j);
          break;
        }
      }
    }
    expect(foreign).not.toBeNull();
    const f = w.evaluate('houses', foreign![0], foreign![1], 0);
    expect(f.ok).toBe(false);
    expect(f.errors.join(' ')).toMatch(/territory|sea/);
    // unaffordable
    w.state.treasury = 1000;
    const castle = w.scenario.landmark!.p;
    const [cx, cz] = w.terrain.toWorld(castle[0], castle[1]);
    const c = w.evaluate('heritage_restoration', cx, cz, 0);
    expect(c.errors.some((e) => e.startsWith('Costs'))).toBe(true);
  });

  it('plans roads that respect the grade limit', () => {
    const w = newShuna();
    const t = w.terrain;
    // from the north estate to the south farm
    const a = t.toWorld(205, 160);
    const b = t.toWorld(140, 300);
    const plan = w.planRoad('road', a, b);
    expect(plan.ok, plan.reason).toBe(true);
    expect(plan.maxGrade).toBeLessThanOrEqual(0.12 + 1e-6);
    expect(plan.length).toBeGreaterThan(Math.hypot(a[0] - b[0], a[1] - b[1]) * 0.99);
    expect(plan.cost).toBeGreaterThan(0);
    const before = w.state.treasury;
    expect(w.buildRoad(plan).ok).toBe(true);
    expect(w.state.treasury).toBeCloseTo(before - plan.cost);
  });

  it('a played island grows: housing + jobs + port bring residents, GDP and trade', () => {
    const w = newShuna(7);
    const t = w.terrain;
    const site = findPortCandidates(w, 'small_harbour', 3)[0];
    const port = w.placeBuilding('small_harbour', site.x, site.z, 0).building!;
    w.startPortUpgrade(port.id, 'road_link');
    const [ex, ez] = t.toWorld(200, 165);
    for (let i = 0; i < 5; i++) placeSomewhere(w, 'houses', ex + i * 40, ez + 30, 0);
    placeSomewhere(w, 'farm', ...t.toWorld(150, 250), 0);
    placeSomewhere(w, 'wind_turbine', ...t.toWorld(165, 220), 0);
    placeSomewhere(w, 'well', ex, ez + 80, 0);
    placeSomewhere(w, 'shop', ex - 60, ez + 40, 0);
    placeSomewhere(w, 'town_hall', ex + 60, ez + 90, 0);
    placeSomewhere(w, 'guesthouse', ex + 120, ez - 20, 0);
    run(w, 730);
    const m = w.lastMonth();
    expect(w.state.pop).toBeGreaterThan(30);
    expect(m.gdp).toBeGreaterThan(0);
    expect(m.revenue).toBeGreaterThan(0);
    expect(m.tradeUsed).toBeGreaterThan(0);
    expect(m.explain.length).toBeGreaterThanOrEqual(0);
    // population never exceeds what housing allows by much
    expect(w.state.pop).toBeLessThanOrEqual(m.housing * 1.1 + 15);
  });

  it('policy changes move the budget and approval in the expected direction', () => {
    const a = newShuna(9);
    const b = newShuna(9);
    b.setPolicy({ incomeTax: 0.4, salesTax: 0.22 });
    run(a, 400);
    run(b, 400);
    const ra = a.state.history.slice(-3).reduce((s, h) => s + h.revenueItems['Income tax'], 0);
    const rb = b.state.history.slice(-3).reduce((s, h) => s + h.revenueItems['Income tax'], 0);
    expect(rb).toBeGreaterThan(ra);
    expect(b.state.approval).toBeLessThan(a.state.approval);
  });

  it('is deterministic for the same seed and actions', () => {
    const a = newShuna(123);
    const b = newShuna(123);
    run(a, 500);
    run(b, 500);
    expect(serializeState(a.state)).toBe(serializeState(b.state));
  });
});

describe('saves', () => {
  it('round-trips the full state', () => {
    const w = newShuna(5);
    w.paintZone('R', 0, 0, 300);
    run(w, 100);
    const env = makeEnvelope(w.state, 'test');
    const back = openEnvelope(JSON.stringify(env));
    expect(serializeState(back)).toBe(serializeState(w.state));
    expect(back.zones).toBeInstanceOf(Uint8Array);
    expect(back.zones.length).toBe(w.state.zones.length);
    // continuing from the save gives the same future
    const w2 = new World(w.terrain, back);
    run(w, 60);
    run(w2, 60);
    expect(serializeState(w2.state)).toBe(serializeState(w.state));
  });

  it('detects corruption and truncation', () => {
    const w = newShuna(5);
    const text = JSON.stringify(makeEnvelope(w.state, 'x'));
    expect(() => openEnvelope(text.slice(0, text.length / 2))).toThrow(SaveError);
    const tampered = JSON.parse(text);
    tampered.payload = tampered.payload.replace('"treasury":', '"treasury":1');
    expect(() => openEnvelope(JSON.stringify(tampered))).toThrow(/Checksum/);
    expect(() => openEnvelope('{"format":"other"}')).toThrow(/Not a Nationforge/);
  });

  it('upgrades older save versions', () => {
    const w = newShuna(5);
    const st: any = JSON.parse(serializeState(w.state));
    st.version = 1;
    delete st.lastAutosaveDay;
    const payload = JSON.stringify(st);
    const env = { ...makeEnvelope(w.state, 'old'), version: 1, payload };
    env.checksum = hashString(payload);
    const back = openEnvelope(JSON.stringify(env));
    expect(back.version).toBe(4);
    expect(back.lastAutosaveDay).toBe(w.state.day);
    expect(deserializeState(payload).zones).toBeInstanceOf(Uint8Array);
  });
});

describe('all five scenarios start and run', () => {
  for (const s of SCENARIOS) {
    it(`${s.id} runs a year without errors`, () => {
      const w = createGame(loadTerrain(s.id), { scenario: s.id, nationName: s.name, flag: { ...FLAG, colors: [...FLAG.colors] }, seed: 99 });
      expect(w.state.pop).toBe(s.startPop);
      run(w, 365);
      const m = w.lastMonth();
      expect(Number.isFinite(m.gdp)).toBe(true);
      expect(Number.isFinite(w.state.treasury)).toBe(true);
      expect(w.state.history.length).toBe(13);
      const sites = findPortCandidates(w, 'commercial_port', 4);
      expect(sites.length).toBeGreaterThan(0);
    });
  }
});
