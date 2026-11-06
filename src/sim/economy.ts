// Pure economic formulas. No state, no randomness: everything here is unit tested (tests/economy.test.ts).

export const ECON = {
  workingAge: 0.64, // share of residents aged 16-66
  participation: 0.74, // share of working-age residents in the labour force
  frictional: 0.025, // unemployment that never goes away (people between jobs)
  rentShare: 0.27, // share of the average wage that market rent takes at balanced supply
  birthRate: 0.0095, // per year
  deathRate: 0.0082,
  consumptionShare: 0.82, // of disposable income
  localServiceShare: 0.4, // of consumption that can be bought from island businesses
  serviceValueAdded: 0.45,
  tourismValueAdded: 0.55,
  constructionValueAdded: 0.45,
  maxMonthlyGrowth: 0.08, // migrants per month cannot exceed 8% of residents + 18 people
  overcrowding: 1.06, // residents can exceed housing capacity by 6% before people leave
} as const;

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

export function labourForce(pop: number, participation: number = ECON.participation): number {
  return pop * ECON.workingAge * participation;
}

/** Employment given a labour force and the jobs on offer. Frictional unemployment never reaches zero. */
export function employment(labour: number, jobs: number): { employed: number; unemployment: number } {
  if (labour <= 0) return { employed: 0, unemployment: 0 };
  const employed = Math.min(labour * (1 - ECON.frictional), Math.max(0, jobs));
  return { employed, unemployment: 1 - employed / labour };
}

/** Monthly wage per worker. Scarce workers (jobs > labour) push wages up, a slack market pulls them down. */
export function wageLevel(baseWage: number, productivity: number, labour: number, jobs: number, priceIndex: number): number {
  const tightness = clamp(labour > 0 ? jobs / labour : 1, 0.4, 1.6);
  return baseWage * productivity * priceIndex * (0.8 + 0.25 * tightness);
}

/**
 * Rent multiplier from housing scarcity. demand = residents plus people who want to move in.
 * Balanced (demand = 85% of supply) gives about 1; a shortage rises steeply, a glut falls to 0.5.
 */
export function rentMultiplier(demand: number, housing: number, policy: 'market' | 'rent_control' | 'social', socialShare: number): number {
  if (housing <= 0) return demand > 0 ? 3.5 : 1;
  const ratio = demand / housing;
  let m = clamp(0.55 + 0.6 * Math.pow(ratio / 0.85, 2.6) * 0.75, 0.5, 3.5);
  if (policy === 'rent_control') m = Math.min(m, 1.15);
  m *= 1 - 0.35 * clamp(socialShare, 0, 1);
  if (policy === 'social') m *= 0.94;
  return m;
}

export interface MigrationInput {
  pop: number;
  housing: number;
  unemployment: number;
  wage: number;
  costOfLiving: number; // rent + living costs per person-month
  utilities: number; // 0..1 satisfaction of power and water
  services: number; // 0..1 average service coverage
  quality: number; // 0..100 environment & amenity
  approval: number; // 0..100
  remoteness: number; // >= 1
  policyMult: number; // immigration policy multiplier on inflow
  reputation: number; // 0..100
  modifier: number; // events
}

export interface MigrationResult {
  immigrants: number;
  emigrants: number;
  attractiveness: number;
  pressure: number; // people who would move in if homes existed
  factors: Record<string, number>;
}

/** Monthly migration. No instant or unlimited growth: inflow needs vacant homes and is capped. */
export function migration(m: MigrationInput): MigrationResult {
  const vacancy = m.housing > 0 ? (m.housing - m.pop) / m.housing : -1;
  const affordability = m.costOfLiving > 0 ? m.wage / m.costOfLiving : 2;
  const factors: Record<string, number> = {
    jobs: 0.3 * clamp(1 - m.unemployment / 0.1, -1, 1),
    housing: 0.2 * clamp(vacancy * 8, -1, 1),
    wages: 0.2 * clamp((affordability - 2.2) / 1.6, -1, 1),
    utilities: 0.1 * clamp((m.utilities - 0.8) * 5, -1, 1),
    services: 0.1 * clamp((m.services - 0.5) * 2, -1, 1),
    quality: 0.1 * clamp((m.quality - 55) / 40, -1, 1),
    remoteness: -0.12 * clamp(m.remoteness - 1, 0, 1),
    reputation: 0.05 * clamp((m.reputation - 50) / 50, -1, 1),
    approval: 0.05 * clamp((m.approval - 50) / 40, -1, 1),
  };
  let a = m.modifier;
  for (const v of Object.values(factors)) a += v;
  a = clamp(a, -1, 1);
  const pool = 14 + 0.035 * m.pop; // people considering a move this month
  const pressure = a > 0 ? a * pool * m.policyMult : 0;
  const vacant = Math.max(0, m.housing * ECON.overcrowding - m.pop);
  const cap = ECON.maxMonthlyGrowth * m.pop + 18;
  const immigrants = Math.max(0, Math.min(pressure, vacant, cap));
  let emigrants = a < 0 ? -a * 0.025 * m.pop : 0;
  // overcrowding forces people out
  const over = m.pop - m.housing * ECON.overcrowding;
  if (over > 0) emigrants += over * 0.5;
  return { immigrants, emigrants: Math.min(emigrants, m.pop), attractiveness: a, pressure, factors };
}

/** Natural change per month. */
export function naturalChange(pop: number): { births: number; deaths: number } {
  return { births: (pop * ECON.birthRate) / 12, deaths: (pop * ECON.deathRate) / 12 };
}

/** Operating efficiency of a building (0..1). No road access means it cannot operate at all. */
export function operatingEfficiency(o: { staffing: number; power: number; water: number; road: boolean; condition: number; inputs: number; needsPower: boolean; needsWater: boolean }): number {
  if (!o.road) return 0;
  const p = o.needsPower ? Math.pow(clamp(o.power, 0, 1), 0.8) : 1;
  const w = o.needsWater ? Math.pow(clamp(o.water, 0, 1), 0.5) : 1;
  return clamp(o.staffing, 0, 1) * p * w * clamp(o.condition, 0, 1) * clamp(o.inputs, 0, 1);
}

/** Monthly inflation (as a fraction). */
export function monthlyInflation(o: { unemployment: number; shortage: number; rentIndex: number; deficitRatio: number; tariff: number; importShare: number }): number {
  const base = 0.0016; // ~2% a year
  const demand = 0.02 * (0.04 - o.unemployment); // tight labour markets heat prices
  const shortage = 0.03 * clamp(o.shortage, 0, 1);
  const housing = 0.002 * (o.rentIndex - 1);
  const fiscal = 0.002 * clamp(o.deficitRatio, -0.5, 0.5);
  const tariffs = 0.006 * o.tariff * o.importShare;
  return clamp(base + demand + shortage + housing + fiscal + tariffs, -0.01, 0.05);
}

/** Annual interest rate charged on public debt. */
export function interestRate(debtRatio: number, stability: number): number {
  return clamp(0.03 + 0.07 * Math.max(0, debtRatio - 0.6) + 0.04 * (1 - clamp(stability, 0, 1)), 0.01, 0.25);
}

export function creditRating(debtRatio: number, stability: number): string {
  const s = stability * 100 - debtRatio * 40;
  if (s > 75) return 'AAA';
  if (s > 62) return 'AA';
  if (s > 50) return 'A';
  if (s > 38) return 'BBB';
  if (s > 26) return 'BB';
  if (s > 14) return 'B';
  return 'CCC';
}

export interface ApprovalInput {
  unemployment: number;
  rentIndex: number;
  taxBurden: number; // weighted average tax rate 0..1
  services: number; // coverage 0..1
  servicesBudget: number; // average budget multiplier (1 = normal)
  env: number; // 0..100
  envWeight: number;
  inflation: number; // annual
  shortage: number; // 0..1
  power: number;
  water: number;
  homeless: number; // share of residents without a home
  modifier: number;
  scale?: number; // < 1 damps job, rent and housing swings in tiny communities
}

/** Target approval (0..100) and the contribution of each factor, for the UI. */
export function approvalTarget(a: ApprovalInput): { target: number; factors: Record<string, number> } {
  const k = a.scale ?? 1;
  const f: Record<string, number> = {
    Jobs: -clamp((a.unemployment - 0.05) * 220, -12, 30) * k,
    Rents: -clamp((a.rentIndex - 1) * 16, -6, 24) * k,
    Taxes: -clamp((a.taxBurden - 0.18) * 70, -8, 25),
    Services: clamp((a.services - 0.55) * 30 + (a.servicesBudget - 1) * 12, -18, 14),
    Environment: clamp(((a.env - 60) * 0.25) * a.envWeight, -18, 12),
    Prices: -clamp((a.inflation - 0.02) * 160, -4, 20),
    Shortages: -clamp(a.shortage * 25, 0, 20),
    Utilities: -clamp((1 - a.power) * 18 + (1 - a.water) * 22, 0, 30),
    Homelessness: -clamp(a.homeless * 120, 0, 20) * k,
    Events: a.modifier,
  };
  let t = 56;
  for (const v of Object.values(f)) t += v;
  return { target: clamp(t, 0, 100), factors: f };
}

/** Gini coefficient over groups with population and per-capita income. */
export function gini(groups: { pop: number; income: number }[]): number {
  const g = groups.filter((x) => x.pop > 0).sort((a, b) => a.income - b.income);
  const total = g.reduce((s, x) => s + x.pop, 0);
  const totalInc = g.reduce((s, x) => s + x.pop * x.income, 0);
  if (total <= 0 || totalInc <= 0) return 0;
  let cumPop = 0;
  let cumInc = 0;
  let area = 0;
  for (const x of g) {
    const p = x.pop / total;
    const inc = (x.pop * x.income) / totalInc;
    area += p * (cumInc * 2 + inc);
    cumPop += p;
    cumInc += inc;
  }
  return clamp(1 - area, 0, 1);
}

/** Herfindahl index of shares (1 = everything in one bucket). Used for economic resilience. */
export function herfindahl(values: number[]): number {
  const total = values.reduce((s, v) => s + Math.max(0, v), 0);
  if (total <= 0) return 1;
  return values.reduce((s, v) => s + Math.pow(Math.max(0, v) / total, 2), 0);
}

/** Wind turbine capacity factor from mean wind speed (m/s). Cubic below rated speed, capped. */
export function windCapacityFactor(v: number): number {
  if (v < 3) return 0;
  if (v > 25) return 0; // cut-out in storms
  return clamp(Math.pow((v - 3) / 9, 3), 0, 1);
}

/** Solar capacity factor from sunshine fraction and latitude (degrees). */
export function solarCapacityFactor(sun: number, latitude: number, month: number): number {
  const southern = latitude < 0;
  const m = southern ? (month + 6) % 12 : month;
  const season = 0.5 + 0.5 * Math.cos(((m - 5.5) / 12) * 2 * Math.PI);
  const latFactor = Math.cos((Math.abs(latitude) * Math.PI) / 180);
  const seasonAmp = clamp((Math.abs(latitude) - 10) / 50, 0, 1);
  return clamp(0.06 + 0.3 * sun * latFactor * (1 - seasonAmp + seasonAmp * season * 1.6), 0, 0.35);
}

/** Tourism demand (visitors/month) before capacity limits. */
export function tourismDemand(o: { base: number; season: number; appeal: number; env: number; envWeight: number; reputation: number; bonus: number; access: number; storms: number }): number {
  const appeal = Math.pow(Math.max(0, o.appeal) / 10, 0.75);
  const env = Math.pow(clamp(o.env / 70, 0.2, 1.4), o.envWeight);
  const rep = 0.6 + 0.8 * clamp(o.reputation / 100, 0, 1);
  return Math.max(0, o.base * o.season * appeal * env * rep * (1 + o.bonus) * o.access * (1 - 0.6 * clamp(o.storms, 0, 1)));
}

/** Foreign direct investment per month. */
export function fdiInflow(o: { gdpAnnual: number; stability: number; corporateTax: number; portTier: number; reputation: number; relations: number; approval: number }): number {
  const score =
    clamp(o.stability, 0, 1) * 0.7 +
    clamp((0.3 - o.corporateTax) * 2.5, -0.5, 0.6) +
    o.portTier * 0.18 +
    clamp((o.reputation - 40) / 60, -0.4, 0.6) +
    clamp(o.relations / 100, -0.4, 0.4) +
    clamp((o.approval - 45) / 100, -0.3, 0.3);
  return Math.max(0, (o.gdpAnnual * 0.003 + 120_000) * score);
}

/** Total tonnage capacity of trade given port capacity, operable share of the month, and handling factors. */
export function tradeCapacity(portCapacity: number, operable: number, ferry: number): number {
  return portCapacity * clamp(operable, 0, 1) + ferry * clamp(0.4 + 0.6 * operable, 0, 1);
}

/** Effective remoteness multiplier on import prices after access improvements. */
export function effectiveRemoteness(base: number, portTier: number, access: number): number {
  return 1 + (base - 1) * clamp(1 - 0.14 * portTier - access, 0.25, 1);
}

/** Months of construction value turned into GDP. */
export function constructionValueAdded(spend: number): number {
  return spend * ECON.constructionValueAdded;
}
