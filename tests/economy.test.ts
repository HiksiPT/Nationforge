import { describe, expect, it } from 'vitest';
import {
  approvalTarget, creditRating, ECON, employment, fdiInflow, gini, herfindahl, interestRate, labourForce, migration, monthlyInflation,
  naturalChange, operatingEfficiency, rentMultiplier, solarCapacityFactor, tourismDemand, tradeCapacity, wageLevel, windCapacityFactor,
  effectiveRemoteness,
} from '../src/sim/economy';
import { allocateTrade } from '../src/sim/engine';

const baseMig = {
  pop: 1000, housing: 1100, unemployment: 0.04, wage: 3500, costOfLiving: 1500, utilities: 1, services: 0.7, quality: 70,
  approval: 60, remoteness: 1.1, policyMult: 1, reputation: 55, modifier: 0,
};

describe('labour market', () => {
  it('labour force is working-age share times participation', () => {
    expect(labourForce(1000)).toBeCloseTo(1000 * ECON.workingAge * ECON.participation);
    expect(labourForce(0)).toBe(0);
  });
  it('employment is capped by jobs and by frictional unemployment', () => {
    const scarce = employment(1000, 600);
    expect(scarce.employed).toBe(600);
    expect(scarce.unemployment).toBeCloseTo(0.4);
    const plenty = employment(1000, 5000);
    expect(plenty.employed).toBeCloseTo(1000 * (1 - ECON.frictional));
    expect(plenty.unemployment).toBeCloseTo(ECON.frictional);
    expect(employment(0, 100)).toEqual({ employed: 0, unemployment: 0 });
  });
  it('wages rise when workers are scarce and with prices', () => {
    const slack = wageLevel(3000, 1, 1000, 500, 1);
    const tight = wageLevel(3000, 1, 1000, 1500, 1);
    expect(tight).toBeGreaterThan(slack);
    expect(wageLevel(3000, 1, 1000, 1000, 1.1)).toBeCloseTo(wageLevel(3000, 1, 1000, 1000, 1) * 1.1);
    // tightness is clamped so wages cannot explode
    expect(wageLevel(3000, 1, 10, 100000, 1)).toBeCloseTo(3000 * (0.8 + 0.25 * 1.6));
  });
});

describe('housing', () => {
  it('scarcity raises rents, gluts lower them', () => {
    const glut = rentMultiplier(500, 1000, 'market', 0);
    const balanced = rentMultiplier(850, 1000, 'market', 0);
    const scarce = rentMultiplier(1300, 1000, 'market', 0);
    expect(glut).toBeLessThan(balanced);
    expect(scarce).toBeGreaterThan(balanced);
    expect(balanced).toBeGreaterThan(0.95);
    expect(balanced).toBeLessThan(1.4);
  });
  it('rent control caps rents and social housing lowers them', () => {
    expect(rentMultiplier(2000, 1000, 'rent_control', 0)).toBeLessThanOrEqual(1.15);
    expect(rentMultiplier(1300, 1000, 'market', 0.3)).toBeLessThan(rentMultiplier(1300, 1000, 'market', 0));
  });
  it('no housing at all means maximum rents', () => {
    expect(rentMultiplier(10, 0, 'market', 0)).toBe(3.5);
  });
});

describe('migration', () => {
  it('attractive islands gain people, but only into vacant homes', () => {
    const r = migration(baseMig);
    expect(r.attractiveness).toBeGreaterThan(0);
    expect(r.immigrants).toBeGreaterThan(0);
    expect(r.immigrants).toBeLessThanOrEqual(1100 * ECON.overcrowding - 1000);
    const full = migration({ ...baseMig, housing: 1000 / ECON.overcrowding });
    expect(full.immigrants).toBeCloseTo(0);
    expect(full.pressure).toBeGreaterThan(0);
  });
  it('growth per month is capped (no instant growth)', () => {
    const r = migration({ ...baseMig, housing: 100000, unemployment: 0.02, wage: 20000, modifier: 1 });
    expect(r.immigrants).toBeLessThanOrEqual(ECON.maxMonthlyGrowth * 1000 + 18 + 1e-9);
  });
  it('unemployment and high costs drive people away', () => {
    const bad = migration({ ...baseMig, unemployment: 0.3, costOfLiving: 4000, services: 0.1 });
    expect(bad.attractiveness).toBeLessThan(0);
    expect(bad.emigrants).toBeGreaterThan(0);
    expect(bad.immigrants).toBe(0);
  });
  it('overcrowding forces people out', () => {
    const r = migration({ ...baseMig, housing: 800 });
    expect(r.emigrants).toBeGreaterThan(0);
  });
  it('immigration policy scales inflow', () => {
    const open = migration(baseMig);
    const closed = migration({ ...baseMig, policyMult: 0.15 });
    expect(closed.immigrants).toBeLessThan(open.immigrants);
  });
  it('natural change is small and positive for a young population', () => {
    const n = naturalChange(12000);
    expect(n.births).toBeCloseTo((12000 * ECON.birthRate) / 12);
    expect(n.births - n.deaths).toBeGreaterThan(0);
  });
});

describe('production and trade', () => {
  it('no road means no operation; shortages multiply', () => {
    const base = { staffing: 1, power: 1, water: 1, road: true, condition: 1, inputs: 1, needsPower: true, needsWater: true };
    expect(operatingEfficiency(base)).toBe(1);
    expect(operatingEfficiency({ ...base, road: false })).toBe(0);
    expect(operatingEfficiency({ ...base, staffing: 0.5 })).toBeCloseTo(0.5);
    expect(operatingEfficiency({ ...base, power: 0.5 })).toBeLessThan(1);
    expect(operatingEfficiency({ ...base, power: 0, needsPower: false })).toBe(1);
  });
  it('trade allocates food and fuel imports before exports', () => {
    const r = allocateTrade({ whisky: 10, food: 0 }, { food: 100 }, { fuel: 50 }, 120);
    expect(r.imports.food).toBeCloseTo(100);
    expect(r.imports.fuel).toBeCloseTo(20);
    expect(r.shortage.fuel).toBeCloseTo(30);
    expect(r.exports.whisky ?? 0).toBe(0);
    expect(r.used).toBeCloseTo(120);
  });
  it('trade exports surplus when there is capacity', () => {
    const r = allocateTrade({ fish: 50 }, { fish: 10 }, {}, 1000);
    expect(r.exports.fish).toBeCloseTo(40);
    expect(r.shortage.fish ?? 0).toBe(0);
  });
  it('trade capacity follows operable days', () => {
    expect(tradeCapacity(1000, 1, 100)).toBeCloseTo(1100);
    expect(tradeCapacity(1000, 0, 100)).toBeCloseTo(40);
  });
  it('bigger ports and air access cut the remoteness premium', () => {
    expect(effectiveRemoteness(1.4, 0, 0)).toBeCloseTo(1.4);
    expect(effectiveRemoteness(1.4, 2, 0)).toBeLessThan(1.4);
    expect(effectiveRemoteness(1.4, 4, 0.5)).toBeGreaterThanOrEqual(1.1);
  });
});

describe('prices, debt and politics', () => {
  it('inflation responds to tight labour, shortages and deficits', () => {
    const calm = monthlyInflation({ unemployment: 0.04, shortage: 0, rentIndex: 1, deficitRatio: 0, tariff: 0, importShare: 0 });
    expect(calm).toBeCloseTo(0.0016);
    expect(monthlyInflation({ unemployment: 0.02, shortage: 0, rentIndex: 1, deficitRatio: 0, tariff: 0, importShare: 0 })).toBeGreaterThan(calm);
    expect(monthlyInflation({ unemployment: 0.04, shortage: 0.5, rentIndex: 1, deficitRatio: 0, tariff: 0, importShare: 0 })).toBeGreaterThan(calm);
    expect(monthlyInflation({ unemployment: 0.04, shortage: 0, rentIndex: 1, deficitRatio: 0.3, tariff: 0, importShare: 0 })).toBeGreaterThan(calm);
    expect(monthlyInflation({ unemployment: -10, shortage: 9, rentIndex: 9, deficitRatio: 9, tariff: 1, importShare: 1 })).toBeLessThanOrEqual(0.05);
  });
  it('interest rates rise with debt and instability', () => {
    expect(interestRate(0.3, 1)).toBeCloseTo(0.03);
    expect(interestRate(1.2, 1)).toBeGreaterThan(interestRate(0.3, 1));
    expect(interestRate(0.3, 0.2)).toBeGreaterThan(interestRate(0.3, 1));
    expect(creditRating(0.2, 0.9)).toBe('AAA');
    expect(creditRating(2, 0.2)).toBe('CCC');
  });
  it('approval: jobs, rents and taxes all matter, and factors sum to the target', () => {
    const good = approvalTarget({ unemployment: 0.04, rentIndex: 1, taxBurden: 0.18, services: 0.8, servicesBudget: 1, env: 75, envWeight: 1, inflation: 0.02, shortage: 0, power: 1, water: 1, homeless: 0, modifier: 0 });
    const bad = approvalTarget({ unemployment: 0.2, rentIndex: 2, taxBurden: 0.35, services: 0.2, servicesBudget: 0.7, env: 30, envWeight: 1, inflation: 0.1, shortage: 0.3, power: 0.5, water: 0.6, homeless: 0.1, modifier: 0 });
    expect(good.target).toBeGreaterThan(60);
    expect(bad.target).toBeLessThan(15);
    const sum = 56 + Object.values(good.factors).reduce((s, v) => s + v, 0);
    expect(good.target).toBeCloseTo(Math.min(100, Math.max(0, sum)));
  });
  it('FDI likes stability, low taxes and a port', () => {
    const base = { gdpAnnual: 50e6, stability: 0.7, corporateTax: 0.18, portTier: 1, reputation: 55, relations: 20, approval: 60 };
    expect(fdiInflow({ ...base, portTier: 3 })).toBeGreaterThan(fdiInflow(base));
    expect(fdiInflow({ ...base, corporateTax: 0.4 })).toBeLessThan(fdiInflow(base));
    expect(fdiInflow({ ...base, stability: 0, reputation: 0, relations: -100, approval: 0, corporateTax: 0.5, portTier: 0 })).toBe(0);
  });
});

describe('inequality, resilience, energy, tourism', () => {
  it('gini is 0 for equal regions and higher for unequal ones', () => {
    expect(gini([{ pop: 100, income: 1000 }, { pop: 100, income: 1000 }])).toBeCloseTo(0);
    expect(gini([{ pop: 100, income: 100 }, { pop: 100, income: 5000 }])).toBeGreaterThan(0.3);
  });
  it('herfindahl is 1 for one sector and 1/n for an even split', () => {
    expect(herfindahl([5, 0, 0])).toBe(1);
    expect(herfindahl([1, 1, 1, 1])).toBeCloseTo(0.25);
  });
  it('wind turbines need wind and cut out in storms', () => {
    expect(windCapacityFactor(2)).toBe(0);
    expect(windCapacityFactor(8)).toBeGreaterThan(windCapacityFactor(5));
    expect(windCapacityFactor(12)).toBeCloseTo(1);
    expect(windCapacityFactor(30)).toBe(0);
  });
  it('solar is stronger in sunny low latitudes', () => {
    expect(solarCapacityFactor(0.8, 38, 6)).toBeGreaterThan(solarCapacityFactor(0.2, 56, 0));
    expect(solarCapacityFactor(1, 0, 0)).toBeLessThanOrEqual(0.35);
  });
  it('tourism follows season, appeal and environment', () => {
    const t = { base: 1000, season: 1, appeal: 10, env: 70, envWeight: 1, reputation: 50, bonus: 0, access: 1, storms: 0 };
    expect(tourismDemand(t)).toBeCloseTo(1000);
    expect(tourismDemand({ ...t, season: 2 })).toBeCloseTo(2000);
    expect(tourismDemand({ ...t, env: 30 })).toBeLessThan(1000);
    expect(tourismDemand({ ...t, appeal: 20 })).toBeGreaterThan(1000);
  });
});
