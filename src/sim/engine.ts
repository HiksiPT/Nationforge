// The simulation clock: fixed one-day steps (construction, weather, disasters) and a monthly economic update.
// Real time is converted into whole days by the caller with an accumulator, so results never depend on frame rate.

import { BUILDING_MAP, RESOURCES, ZONE_FROM_CODE, type BuildingDef, type ResId, type ZoneId } from '../data/catalogue';
import { TECH_MAP } from '../data/research';
import { MASK } from '../geo/terrain';
import { dateOf, isMonthStart, MONTH_NAMES } from './calendar';
import { exportPriceFactor, tariffableShare, tourismRelationFactor, updateRelations } from './diplomacy';
import {
  approvalTarget, clamp, constructionValueAdded, creditRating, ECON, effectiveRemoteness, employment, fdiInflow, gini, herfindahl,
  interestRate, labourForce, migration, monthlyInflation, naturalChange, operatingEfficiency, rentMultiplier, solarCapacityFactor,
  tourismDemand, tradeCapacity, wageLevel, windCapacityFactor,
} from './economy';
import { maybeTriggerEvent, rollDisasters, DISASTER_INFO } from './events';
import { constructionFactor, nextWeather, portOperable } from './weather';
import type { Building, GameState, MonthRecord } from './types';
import { emptyOps } from './types';
import { money, type World } from './world';

const RES_IDS = Object.keys(RESOURCES) as ResId[];
export const POWER_PRICE = 240; // $ per MWh
export const WATER_PRICE = 1.6; // $ per m3
export const FUEL_PER_MW = 158; // tonnes of diesel per MW-month

// ------------------------------------------------------------------ daily step

export function advanceDay(w: World) {
  const st = w.state;
  st.day++;
  const month = w.month();
  const drought = st.disasters.some((d) => d.kind === 'drought');
  st.weather = nextWeather(w.scenario.climate, month, st.weather, w.rng, drought ? 0.15 : 1);
  const wx = st.weather;
  const acc = st.monthAcc;
  acc.days++;
  acc.windSum += windCapacityFactor(wx.wind);
  acc.sunSum += 1 - wx.cloud;
  acc.rainSum += wx.rain;
  if (wx.storm) acc.stormDays++;
  if (wx.fog > 0) acc.fogDays++;
  const ports = w.activePorts();
  const shelter = ports.length ? Math.max(...ports.map((p) => p.shelter ?? 0.5)) : 0.35;
  const strike = st.disasters.some((d) => d.kind === 'storm' && d.severity < 0.5 && d.start !== st.day && !d.at && d.days > 10);
  acc.portClosedDays += 1 - portOperable(wx, shelter) * (strike ? 0.5 : 1);

  // construction progress
  let factor = constructionFactor(wx) * (1 + w.techBonus('construction'));
  for (const m of st.modifiers) if (m.target === 'construction') factor *= 1 + m.value;
  let changed = false;
  let roadsChanged = false;
  for (const b of st.buildings) {
    const def = BUILDING_MAP[b.type];
    if (b.status === 'construction') {
      if (b.consultDays && b.consultDays > 0) {
        b.consultDays--;
        if (b.consultDays === 0) w.notify('info', `Consultation complete: ${def.name}`, 'The community agreed to the plans; work begins.', [b.x, b.z]);
        continue;
      }
      const portBonus = def.port && w.hasTech('harbour_eng') ? 1.25 : 1;
      const step = (factor * portBonus) / def.days;
      b.progress = Math.min(1, b.progress + step);
      acc.constructionSpend += (def.cost * w.costIndex() * Math.min(step, 1)) * 0.9;
      if (b.progress >= 1) {
        b.status = 'active';
        b.doneDay = st.day;
        st.stats.builtCount++;
        changed = true;
        roadsChanged = true;
        if (b.owner === 'state' || def.port || def.unique) w.notify('good', `${def.name} completed`, completionText(w, b, def), [b.x, b.z]);
      }
    }
    if (b.pending && b.pending.length) {
      const p = b.pending[0];
      p.progress = Math.min(1, p.progress + factor / Math.max(1, p.days));
      acc.constructionSpend += 20_000 * factor;
      if (p.progress >= 1) {
        b.pending.shift();
        b.upgrades = { ...b.upgrades, [p.id]: (b.upgrades?.[p.id] ?? 0) + 1 };
        if (p.id === 'breakwater') b.shelter = Math.min(0.97, (b.shelter ?? 0.5) + 0.35);
        if (p.id === 'dredging') b.depth = (b.depth ?? 0) + 3;
        changed = true;
        w.notify('good', `${upgradeName(p.id)} finished`, `${def.name}: ${upgradeEffect(p.id, b)}`, [b.x, b.z]);
      }
    }
  }
  for (const r of st.roads) {
    if (r.status !== 'construction') continue;
    const days = Math.max(8, ((r.length / w.terrain.hs) / 1000) * ({ track: 20, road: 45, avenue: 80 }[r.cls]));
    r.progress = Math.min(1, r.progress + factor / days);
    acc.constructionSpend += (r.cost / days) * factor * 0.9;
    if (r.progress >= 1) {
      r.status = 'active';
      roadsChanged = true;
      changed = true;
    }
  }
  if (roadsChanged) w.computeRoadComponents();

  // disasters
  for (const d of st.disasters) d.days--;
  const ended = st.disasters.filter((d) => d.days <= 0);
  if (ended.length) {
    st.disasters = st.disasters.filter((d) => d.days > 0);
    for (const d of ended) if (d.days > -1 && DISASTER_INFO[d.kind].days[1] > 5) w.notify('info', `${DISASTER_INFO[d.kind].name} is over`);
  }
  rollDisasters(w);
  st.modifiers = st.modifiers.filter((m) => m.until > st.day);

  if (isMonthStart(st.day)) monthlyUpdate(w);
  w.emit(changed);
}

function upgradeName(id: string) {
  return { breakwater: 'Breakwater', dredging: 'Dredging', quay: 'Quay extension', customs: 'Customs house', utility_link: 'Utility link', rail_link: 'Rail link', road_link: 'Road link' }[id] ?? id;
}

function upgradeEffect(id: string, b: Building) {
  switch (id) {
    case 'breakwater':
      return `shelter now ${Math.round((b.shelter ?? 0) * 100)}%.`;
    case 'dredging':
      return `berth depth now ${(b.depth ?? 0).toFixed(1)} m.`;
    default:
      return 'now in service.';
  }
}

function completionText(w: World, b: Building, def: BuildingDef): string {
  const road = w.roadStatus(b);
  if (road === 'none' && def.site !== 'sea') return 'Warning: it has no road access and cannot operate yet.';
  if (def.port) return `Capacity ${def.port.capacity.toLocaleString()} t/month. ${b.upgrades?.utility_link ? '' : 'Add a utility link for full capacity.'}`;
  if (def.housing) return `${def.housing} new homes available.`;
  if (def.jobs) return `${def.jobs} jobs on offer.`;
  return 'Now operating.';
}

// ------------------------------------------------------------------ monthly economy

export function monthlyUpdate(w: World) {
  const st = w.state;
  const sc = w.scenario;
  const t = w.terrain;
  const acc = st.monthAcc;
  const days = Math.max(1, acc.days);
  const prevDate = dateOf(st.day - 1, st.startYear);
  const month = prevDate.month;
  const P = st.policy;
  const prev = w.lastMonth();
  const explain: string[] = [];
  const lat = t.meta.center[0];

  const modSum = (target: string) => st.modifiers.filter((m) => m.target === target).reduce((s, m) => s + m.value, 0);

  // ---------- which buildings operate
  const live = st.buildings.filter((b) => b.status !== 'construction');
  for (const b of st.buildings) if (b.status === 'construction') b.ops = { ...emptyOps(), issues: ['Under construction'] };
  const road = new Map<number, 'hub' | 'local' | 'none'>();
  for (const b of live) road.set(b.id, w.roadStatus(b));

  // ---------- labour market
  let jobs = 0;
  let housing = 0;
  let socialHousing = 0;
  for (const b of live) {
    const d = BUILDING_MAP[b.type];
    const r = road.get(b.id)!;
    if (d.jobs && r !== 'none') jobs += d.jobs * b.condition;
    if (d.housing && r !== 'none') {
      housing += d.housing * b.condition;
      if (d.socialRent) socialHousing += d.housing;
    }
  }
  // the original homes of the starting population count even without roads
  for (const b of live) {
    const d = BUILDING_MAP[b.type];
    if (d.housing && road.get(b.id) === 'none') housing += d.housing * b.condition * (b.owner === 'community' ? 1 : 0.6);
  }
  jobs += st.legacy.jobs;
  const busReach = live.some((b) => b.type === 'bus_depot' && b.status === 'active') ? 0.05 : 0;
  const participation = ECON.participation * (P.immigration === 'skilled' ? 1.02 : 1) + busReach * 0.3;
  const pop = st.pop;
  const labour = labourForce(pop, participation);
  const { employed, unemployment } = employment(labour, jobs);
  const staffing = jobs > 0 ? employed / jobs : 0;

  // ---------- power & water (first pass)
  const legacyPower = st.legacy.power;
  const legacyWater = st.legacy.water;
  const windCF = acc.windSum / days;
  const sunF = acc.sunSum / days;
  const rainFactor = clamp(acc.rainSum / Math.max(1, days) / Math.max(0.5, sc.climate.rain[month] * 7), 0.15, 1.6);
  const drought = st.disasters.some((d) => d.kind === 'drought');
  const renewBonus = 1 + w.techBonus('renewable') + (P.energy === 'green' ? 0.05 : 0);
  let renewable = 0;
  let dieselCap = 0;
  let batteries = 0;
  let powerDemand = 0;
  let waterSupply = legacyWater;
  let waterDemand = 0;
  let treats = 0;
  let recycles = 0;
  const plantOut = new Map<number, number>(); // renewable MW actually generated per plant
  const plantEff = (b: Building) => {
    const d = BUILDING_MAP[b.type];
    // power lines and pipes can run cross-country: plants work if within 800 m of the road network
    if (road.get(b.id) === 'none' && d.site !== 'coast' && w.nearestRoad(b.x, b.z, 800, true).dist > 800) return 0;
    const s = d.jobs ? Math.min(1, staffing * 1.3) : 1;
    return s * b.condition;
  };
  for (const b of live) {
    const d = BUILDING_MAP[b.type];
    const e = plantEff(b);
    if ((d.power ?? 0) > 0 || d.powerKind) {
      switch (d.powerKind) {
        case 'diesel':
          dieselCap += d.power! * e;
          break;
        case 'wind':
          plantOut.set(b.id, d.power! * e * windCF * 0.95 * renewBonus);
          break;
        case 'solar':
          plantOut.set(b.id, d.power! * e * solarCapacityFactor(sunF, lat, month) * renewBonus);
          break;
        case 'hydro':
          plantOut.set(b.id, d.power! * e * clamp(0.25 + 0.55 * rainFactor, 0.1, 1) * renewBonus);
          break;
        case 'wave':
          plantOut.set(b.id, d.power! * e * clamp(0.25 + windCF * 0.6, 0.15, 0.8) * renewBonus);
          break;
        case 'battery':
          batteries++;
          break;
      }
    }
    if ((d.power ?? 0) < 0 && road.get(b.id) !== 'none') powerDemand += -d.power! * (d.housing ? 1 : b.condition);
    if ((d.water ?? 0) > 0) {
      let wv = d.water! * e;
      if (d.waterKind === 'well') wv *= sc.groundwater * (1 + w.techBonus('water')) * (drought ? 0.55 : 1);
      if (d.waterKind === 'rain') wv *= rainFactor * (drought ? 0.2 : 1);
      if (d.waterKind === 'reservoir') wv *= clamp(0.55 + 0.45 * rainFactor, 0.3, 1.3) * (drought ? 0.5 : 1);
      waterSupply += wv;
    }
    if ((d.water ?? 0) < 0 && road.get(b.id) !== 'none') waterDemand += -d.water! * (1 - w.techBonus('water'));
    if (d.treats) treats += d.treats * e;
    if (d.recycles) recycles += d.recycles * e;
  }
  for (const v of plantOut.values()) renewable += v;
  const firm = Math.min(batteries * 5, renewable * 0.3 * (1 + 0.15 * batteries));
  renewable += firm;
  renewable += legacyPower * 0.0; // the legacy supply is a small diesel set
  dieselCap += legacyPower;
  const dieselNeed = clamp(powerDemand - renewable, 0, dieselCap);
  const fuelForPower = dieselNeed * FUEL_PER_MW * (P.energy === 'fossil' ? 0.95 : 1);

  // ---------- productivity and wages
  const services = serviceCoverage(w, live, road, staffing, pop);
  const fdiStock = st.countries.reduce((s, c) => s + c.investment, 0);
  const gdpAnnualPrev = prev?.gdpAnnual ?? Math.max(1, pop * 25000);
  let productivity = 1 + w.techBonus('productivity') + 0.12 * services.education + (live.some((b) => b.type === 'telecom_mast' && b.status === 'active') ? 0.03 : 0);
  productivity += clamp((fdiStock / Math.max(gdpAnnualPrev, 1)) * 0.08, 0, 0.1);
  if (P.immigration === 'skilled') productivity += 0.03;
  if (P.regionFocus >= 0) productivity += 0.025;
  productivity += modSum('productivity');
  const wage = wageLevel(sc.baseWage, productivity, labour, jobs, st.priceIndex);
  st.wageLevel = wage;

  // ---------- tourism
  const ports = live.filter((b) => BUILDING_MAP[b.type].port && b.status === 'active');
  let appeal = 4 + (t.meta.stats.flatTerritoryPct > 0 ? 0 : 0);
  let beds = 0, yachtCap = 0, cruiseCap = 0, access = 0;
  for (const b of live) {
    const d = BUILDING_MAP[b.type];
    const e = road.get(b.id) === 'none' && d.site !== 'sea' ? 0 : b.condition * (d.jobs ? Math.min(1, staffing * 1.2) : 1);
    if (d.appeal) {
      let a = d.appeal * e;
      if (d.id === 'dive_centre') a *= clamp(st.env.marine / 70, 0.2, 1.3);
      if (d.id === 'visitor_centre') a *= clamp(st.env.quality / 70, 0.3, 1.3);
      appeal += a;
    }
    if (d.beds) beds += d.beds * e;
    if (d.port?.yachts) yachtCap += d.port.yachts * e;
    if (d.port?.cruise) cruiseCap += d.port.cruise * e;
    if (d.access) access += d.access * e;
  }
  const portTier = w.maxPortTier();
  const passengerCap = sc.ferryCapacity * 9 + ports.reduce((s, p) => s + ({ 1: 3000, 2: 9000, 3: 6000, 4: 4000 } as Record<number, number>)[BUILDING_MAP[p.type].port!.tier] * p.condition, 0) + access * 40000;
  const operable = clamp(1 - acc.portClosedDays / days, 0, 1);
  const season = sc.tourismSeason[month];
  const tourismBonus = w.techBonus('tourism') + modSum('tourism') + (P.budget.culture - 1) * 0.15;
  const demand = tourismDemand({
    base: sc.tourismBase, season, appeal, env: st.env.quality, envWeight: sc.envWeight, reputation: st.reputation,
    bonus: tourismBonus, access: tourismRelationFactor(w) * (1 + access), storms: acc.stormDays / days,
  });
  const avgStay = 4;
  const bedCap = (beds * days * 0.9) / avgStay;
  const overnight = Math.min(demand, bedCap, passengerCap * operable);
  const yachts = Math.min(yachtCap * season * clamp(appeal / 12, 0.2, 1.5) * operable, demand * 0.5);
  const cruise = Math.min(cruiseCap * clamp(season, 0.3, 1.6) * operable, demand * 2.5) * (1 + modSum('tourism'));
  const touristNights = overnight * avgStay + yachts * 2;
  const tourSpend = (overnight * sc.touristSpend + yachts * sc.touristSpend * 0.8 + cruise * sc.touristSpend * 0.18) * st.priceIndex;
  waterDemand += touristNights * 0.25;
  powerDemand += touristNights * 0.00002;

  // ---------- production (two passes so input shortages feed back)
  const exportF: Partial<Record<ResId, number>> = {};
  for (const r of RES_IDS) exportF[r] = exportPriceFactor(w, r);
  const remoteEff = effectiveRemoteness(sc.remoteness, portTier, access);
  const strictEnv = P.environment === 'strict';
  const algal = st.disasters.some((d) => d.kind === 'algal_bloom');
  const fishBonus = 1 + w.techBonus('fish');
  const farmBonus = 1 + w.techBonus('farm');
  const stormFrac = acc.stormDays / days;

  let powerSat = powerDemand <= 1e-6 ? 1 : clamp((renewable + dieselNeed) / powerDemand, 0, 1);
  let waterSat = waterDemand <= 1e-6 ? 1 : clamp(waterSupply / waterDemand, 0, 1);
  let inputSat: Partial<Record<ResId, number>> = {};
  let production: Partial<Record<ResId, number>> = {};
  let inputsNeed: Partial<Record<ResId, number>> = {};
  let tradeResult = { exports: {} as Partial<Record<ResId, number>>, imports: {} as Partial<Record<ResId, number>>, shortage: {} as Partial<Record<ResId, number>>, used: 0, capacity: 0 };
  const consumption: Partial<Record<ResId, number>> = {};
  for (const r of RES_IDS) consumption[r] = RESOURCES[r].perCapita * (pop + touristNights / 30);

  const capPort = portCapacity(w, ports);
  const tradeCap = tradeCapacity(capPort, operable, sc.ferryCapacity) * (st.disasters.some((d) => d.kind === 'storm' && d.days > 10) ? 0.5 : 1);
  const effMap = new Map<number, number>();
  for (let pass = 0; pass < 2; pass++) {
    production = {};
    inputsNeed = { fuel: fuelForPower };
    for (const b of live) {
      const d = BUILDING_MAP[b.type];
      if (!d.out && !d.inp) continue;
      if (d.powerKind === 'diesel') continue;
      const r = road.get(b.id)!;
      let inputs = 1;
      if (d.inp && pass === 1) for (const k of Object.keys(d.inp) as ResId[]) inputs = Math.min(inputs, inputSat[k] ?? 1);
      let e = operatingEfficiency({ staffing, power: powerSat, water: waterSat, road: r !== 'none', condition: b.condition, inputs, needsPower: (d.power ?? 0) < 0, needsWater: (d.water ?? 0) < 0 });
      if (r === 'local') e *= 0.8;
      if (d.id === 'fishing_fleet' || d.id === 'aquaculture' || d.id === 'pearl_farm') e *= fishBonus * (1 - stormFrac * 1.2) * (algal ? 0.1 : 1);
      if (d.id === 'pearl_farm') e *= clamp(st.env.marine / 75, 0.2, 1.1);
      if (['farm', 'olive_grove', 'vineyard', 'fruit_plantation', 'sheep_farm'].includes(d.id)) e *= farmBonus * (drought ? 0.65 : 1);
      if (d.id === 'fishing_fleet') e *= clamp(st.env.marine / 70, 0.3, 1.1);
      if (strictEnv && (d.pollution ?? 0) > 1) e *= 0.9;
      if (P.environment === 'lax' && (d.pollution ?? 0) > 1) e *= 1.05;
      e = Math.max(0, e);
      effMap.set(b.id, e);
      for (const [k, v] of Object.entries(d.out ?? {}) as [ResId, number][]) production[k] = (production[k] ?? 0) + v * e;
      for (const [k, v] of Object.entries(d.inp ?? {}) as [ResId, number][]) inputsNeed[k] = (inputsNeed[k] ?? 0) + v * e;
    }
    tradeResult = allocateTrade(production, consumption, inputsNeed, tradeCap);
    inputSat = {};
    for (const r of RES_IDS) {
      const need = (inputsNeed[r] ?? 0) + (consumption[r] ?? 0);
      inputSat[r] = need > 0 ? 1 - (tradeResult.shortage[r] ?? 0) / need : 1;
    }
  }
  // fuel shortages throttle the diesel plant
  const fuelSat = inputSat.fuel ?? 1;
  const dieselOut = dieselNeed * fuelSat;
  const powerSupply = renewable + dieselOut;
  powerSat = powerDemand <= 1e-6 ? 1 : clamp(powerSupply / powerDemand, 0, 1);
  waterSat = waterDemand <= 1e-6 ? 1 : clamp(waterSupply / waterDemand, 0, 1);

  // ---------- money flows of production
  let exportValue = 0, importValue = 0, tariffRev = 0;
  const exportsBy: MonthRecord['exportsBy'] = {};
  const importsBy: MonthRecord['importsBy'] = {};
  const tShare = tariffableShare(w);
  for (const r of RES_IDS) {
    const ex = tradeResult.exports[r] ?? 0;
    const im = tradeResult.imports[r] ?? 0;
    if (ex > 0) {
      const v = ex * RESOURCES[r].price * (exportF[r] ?? 1);
      exportValue += v;
      exportsBy[r] = v;
      st.exportsTotal[r] = (st.exportsTotal[r] ?? 0) + ex;
    }
    if (im > 0) {
      const v = im * RESOURCES[r].price * remoteEff;
      importValue += v * (1 + P.tariff * tShare);
      tariffRev += v * P.tariff * tShare;
      importsBy[r] = v;
    }
  }
  const priceOf = (r: ResId) => RESOURCES[r].price * (exportF[r] ?? 1);
  const inputPrice = (r: ResId) => {
    const need = (inputsNeed[r] ?? 0) + (consumption[r] ?? 0);
    const impShare = need > 0 ? (tradeResult.imports[r] ?? 0) / need : 0;
    return RESOURCES[r].price * (1 - impShare + impShare * remoteEff * (1 + P.tariff * tShare));
  };

  // ---------- households
  const incomeTaxRate = P.incomeTax;
  const payroll = employed * wage;
  const disposable = payroll * (1 - incomeTaxRate);
  const consumptionSpend = disposable * ECON.consumptionShare;
  const commerceCov = services.commerce;
  const localServices = consumptionSpend * ECON.localServiceShare * commerceCov + tourSpend * 0.12;

  // ---------- per-building operations, revenue and profits
  const sectors: Record<string, number> = { 'Farming & fishing': 0, Industry: 0, Tourism: 0, Services: 0, 'Public sector': 0, Construction: 0, 'Ports & logistics': 0, Energy: 0 };
  let stateProfit = 0, privateProfit = 0, publicWages = 0, publicMaint = 0, stateRent = 0, propertyValue = 0, utilityRevenue = 0;
  const totalCommerce = live.reduce((s, b) => s + (BUILDING_MAP[b.type].commerce ?? 0) * (effMap.get(b.id) ?? b.condition * staffing), 0) || 1;
  const rentM = rentMultiplier(pop + (prev ? Math.max(0, prev.attractiveness) * (14 + 0.035 * pop) * 2 : 0), housing, P.housing, housing > 0 ? socialHousing / housing : 0);
  const rentPerPerson = wage * ECON.rentShare * rentM * 0.5; // per resident (about two residents per earner)
  const budgetOf = (d: BuildingDef) => {
    const k = d.service?.kind;
    if (k === 'education') return P.budget.education;
    if (k === 'health') return P.budget.health;
    if (k === 'safety') return P.budget.safety;
    if (d.cat === 'utility' || d.cat === 'transport' || d.cat === 'port') return P.budget.infrastructure;
    if (k === 'leisure') return P.budget.culture;
    return 1;
  };
  const occupancy = housing > 0 ? Math.min(1, pop / housing) : 0;
  const tourismBuildings = live.filter((b) => BUILDING_MAP[b.type].beds || BUILDING_MAP[b.type].appeal);
  const totalBedsEff = live.reduce((s, b) => s + (BUILDING_MAP[b.type].beds ?? 0) * b.condition, 0) || 1;
  const totalAppeal = Math.max(1, appeal - 4);
  let researchPts = 1;
  for (const b of st.buildings) {
    const d = BUILDING_MAP[b.type];
    if (b.status === 'construction') continue;
    const r = road.get(b.id)!;
    const ops = emptyOps();
    ops.road = r !== 'none';
    ops.jobs = (d.jobs ?? 0) * b.condition;
    ops.workers = ops.road ? ops.jobs * staffing : 0;
    ops.staffing = ops.road ? staffing : 0;
    ops.power = (d.power ?? 0) < 0 ? powerSat : 1;
    ops.water = (d.water ?? 0) < 0 ? waterSat : 1;
    const e = effMap.get(b.id) ?? (ops.road ? clamp((d.jobs ? staffing : 1) * b.condition * ((d.power ?? 0) < 0 ? Math.pow(powerSat, 0.8) : 1), 0, 1) * (r === 'local' ? 0.85 : 1) : 0);
    ops.efficiency = e;
    const wageCost = ops.workers * wage * (d.wageMult ?? 1) * (d.service || d.cat === 'public' ? budgetOf(d) : 1);
    const maint = d.maint * st.priceIndex * (d.service ? budgetOf(d) : 1) * (b.owner === 'state' ? 1 : 0);
    let revenue = 0;
    let va = 0;
    let sector = 'Services';
    for (const [k, v] of Object.entries(d.out ?? {}) as [ResId, number][]) {
      const q = v * e;
      ops.output[k] = q;
      revenue += q * priceOf(k);
    }
    let inputCost = 0;
    // diesel fuel is charged below from the power actually dispatched, not from the nameplate input
    if (d.powerKind !== 'diesel') for (const [k, v] of Object.entries(d.inp ?? {}) as [ResId, number][]) inputCost += v * e * inputPrice(k);
    if (d.powerKind === 'diesel') inputCost += fuelForPower > 0 ? (dieselOut / Math.max(0.001, dieselCap)) * d.power! * b.condition * FUEL_PER_MW * inputPrice('fuel') : 0;
    if (d.out || d.inp) sector = ['farm', 'olive_grove', 'vineyard', 'fruit_plantation', 'sheep_farm', 'fishing_fleet', 'aquaculture', 'pearl_farm'].includes(d.id) ? 'Farming & fishing' : 'Industry';
    if (d.servicesExport) {
      revenue += d.servicesExport * e * st.priceIndex * (d.id === 'data_centre' ? (sc.climate.temp.reduce((a, x) => a + x, 0) / 12 < 12 ? 1.15 : 0.95) : 1);
      exportsBy.services = (exportsBy.services ?? 0) + d.servicesExport * e * st.priceIndex;
    }
    if (d.commerce) revenue += (localServices * ((d.commerce * e) / totalCommerce)) * 1.0;
    if (d.beds || d.appeal) {
      sector = 'Tourism';
      const shareBeds = d.beds ? (d.beds * b.condition) / totalBedsEff : 0;
      const shareAppeal = (d.appeal ?? 0) / totalAppeal;
      revenue += tourSpend * 0.7 * shareBeds + tourSpend * 0.06 * Math.min(1, shareAppeal);
    }
    if (d.port) {
      sector = 'Ports & logistics';
      const share = capPort > 0 ? portCap(w, b) / capPort : 0;
      revenue += (tradeResult.used * 25 * share + overnight * 8 * share) * st.priceIndex + (d.port.cruise ? cruise * 22 : 0) + (d.port.yachts ? yachts * 60 : 0);
    }
    if (d.cat === 'utility' && ((d.power ?? 0) > 0 || (d.water ?? 0) > 0 || d.powerKind)) {
      sector = 'Energy';
      // utilities sell power and water to the grid
      // renewables are dispatched first; only power that is actually used gets paid for
      const renewSold = Math.min(renewable, powerDemand);
      const dieselSold = Math.min(dieselOut, Math.max(0, powerDemand - renewSold));
      const mwh = d.powerKind === 'diesel' ? (dieselSold * (d.power! * b.condition)) / Math.max(0.001, dieselCap) * 720 : d.powerKind && d.powerKind !== 'battery' ? (renewSold * (plantOut.get(b.id) ?? 0)) / Math.max(1e-6, renewable - firm) * 720 : 0;
      revenue += Math.max(0, mwh) * POWER_PRICE * st.priceIndex + Math.max(0, d.water ?? 0) * e * WATER_PRICE * st.priceIndex * clamp(waterDemand / Math.max(1, waterSupply), 0, 1);
      utilityRevenue += revenue;
    }
    if (d.housing) {
      const occupants = d.housing * b.condition * occupancy;
      const rent = occupants * rentPerPerson * (d.socialRent ? 0.55 : 1);
      if (b.owner === 'state') stateRent += rent;
      propertyValue += d.cost * st.priceIndex * (0.6 + 0.4 * rentM);
      va += rent * 0.6;
      sector = 'Services';
      ops.issues.push(`${Math.round(occupants)} residents`);
    }
    // businesses and public buildings pay for the power and water they use
    const bills = d.housing ? 0 : (Math.max(0, -(d.power ?? 0)) * 720 * POWER_PRICE * powerSat + Math.max(0, -(d.water ?? 0)) * WATER_PRICE * waterSat) * st.priceIndex * (ops.road ? 1 : 0);
    inputCost += bills;
    const profit = revenue - wageCost - inputCost - maint - (b.owner === 'private' ? d.maint * st.priceIndex : 0);
    ops.revenue = revenue;
    ops.profit = profit;
    if (d.service || d.cat === 'public') {
      publicWages += wageCost;
      publicMaint += maint + bills;
      sector = 'Public sector';
      va += wageCost;
    } else if (!d.housing) {
      va += revenue - inputCost;
      if (b.owner === 'state') {
        stateProfit += profit + maint; // maintenance is counted with public maintenance below
        publicMaint += maint;
      } else privateProfit += Math.max(0, profit);
    } else if (b.owner === 'state') {
      publicMaint += maint;
    }
    sectors[sector] = (sectors[sector] ?? 0) + va;
    if (d.research) researchPts += d.research * e * P.budget.education;
    // issues for the info panel
    if (!ops.road && d.site !== 'sea') ops.issues.unshift('No road access');
    else if (r === 'local') ops.issues.push('Road not connected to a port or town hall');
    if (d.jobs && staffing < 0.95 && ops.road) ops.issues.push(`Short of workers (${Math.round(staffing * 100)}% staffed)`);
    if ((d.power ?? 0) < 0 && powerSat < 0.98) ops.issues.push(`Power shortage (${Math.round(powerSat * 100)}%)`);
    if ((d.water ?? 0) < 0 && waterSat < 0.98) ops.issues.push(`Water shortage (${Math.round(waterSat * 100)}%)`);
    for (const k of Object.keys(d.inp ?? {}) as ResId[]) if ((inputSat[k] ?? 1) < 0.95) ops.issues.push(`Short of ${RESOURCES[k].name.toLowerCase()}`);
    if (b.condition < 0.95) ops.issues.push(`Damaged (${Math.round(b.condition * 100)}%)`);
    if (b.status === 'damaged' && b.condition >= 0.6) b.status = 'active';
    b.ops = ops;
  }
  void tourismBuildings;
  // the pre-existing local economy (value added about twice the wage bill, as in most economies)
  sectors['Services'] += localServices * ECON.serviceValueAdded * 0.3 + st.legacy.jobs * staffing * wage * 2;
  sectors['Construction'] += constructionValueAdded(acc.constructionSpend);
  sectors['Tourism'] += tourSpend * 0.15;

  // ---------- government budget
  const corpRate = P.corporateTax;
  const roadLen = st.roads.reduce((s, r) => s + (r.status === 'active' && !r.osm ? r.length : r.osm ? r.length * 0.4 : 0), 0) / t.hs;
  const revenueItems: Record<string, number> = {
    'Income tax': payroll * incomeTaxRate,
    'Corporate tax': privateProfit * corpRate + Math.max(0, modSum('fdi') < 0 ? modSum('fdi') : 0),
    'Sales tax': consumptionSpend * 0.7 * P.salesTax,
    'Tourism levy': tourSpend * P.tourismTax,
    'Property tax': (propertyValue * P.propertyTax) / 12,
    Tariffs: tariffRev,
    'State enterprises': stateProfit,
    'State rents': stateRent,
  };
  const envSpend = (3_000 + pop * 9 + st.buildings.length * 300) * P.budget.environment * st.priceIndex;
  const cultureSpend = (2_000 + pop * 4) * P.budget.culture * st.priceIndex;
  const socialSub = P.housing === 'social' ? socialHousing * rentPerPerson * 0.3 + 15_000 : 0;
  const greenSub = P.energy === 'green' ? renewable * 720 * 25 : 0;
  const fossilSub = P.energy === 'fossil' ? dieselOut * 720 * 12 : 0;
  const roadUpkeep = roadLen * 0.9 * P.budget.infrastructure * st.priceIndex;
  const rate = interestRate(prev ? st.debt / Math.max(1, prev.gdpAnnual) : 0, st.stability);
  const interest = (st.debt * rate) / 12;
  const expenseItems: Record<string, number> = {
    'Public wages': publicWages,
    Maintenance: publicMaint,
    'Road upkeep': roadUpkeep,
    Environment: envSpend,
    'Culture & promotion': cultureSpend,
    'Housing subsidies': socialSub,
    'Energy subsidies': greenSub + fossilSub,
    'Debt interest': interest,
  };
  // state enterprise losses show as negative revenue
  const revenue = Object.values(revenueItems).reduce((s, v) => s + v, 0);
  const expenditure = Object.values(expenseItems).reduce((s, v) => s + v, 0);
  const balance = revenue - expenditure;
  st.treasury += balance;
  if (st.treasury < 0 && P.autoBorrow) {
    const need = -st.treasury + 1_000_000;
    const limit = w.borrowLimit();
    const take = Math.min(need, limit);
    if (take > 0) {
      st.debt += take;
      st.treasury += take;
      explain.push(`Borrowed ${money(take)} automatically to cover the deficit.`);
    }
  }
  if (st.treasury < 0) {
    w.notify('bad', 'Treasury empty', 'Bills are going unpaid. Raise taxes, cut budgets or allow more borrowing.');
    st.modifiers.push({ id: 'insolvent', label: 'Unpaid bills', target: 'approval', value: -6, until: st.day + 30 });
  }
  st.surplusStreak = balance >= 0 ? st.surplusStreak + 1 : 0;

  // ---------- environment
  const pollutionTech = 1 - w.techBonus('pollution');
  let pollution = 0;
  for (const b of live) {
    const d = BUILDING_MAP[b.type];
    if (d.pollution) pollution += d.pollution * (effMap.get(b.id) ?? b.condition) * pollutionTech;
  }
  pollution += (dieselOut / 4) * 3.5 * pollutionTech;
  pollution *= strictEnv ? 0.8 : P.environment === 'lax' ? 1.25 : 1;
  pollution = Math.max(0, pollution - recycles - (P.budget.environment - 1) * 2);
  const untreated = Math.max(0, pop + touristNights / 30 - treats);
  const areaKm2 = Math.max(0.5, t.meta.stats.territoryKm2 * t.hs * t.hs);
  const forestStart = Math.max(1, st.env.forestStart);
  const forestShare = clamp(1 - st.env.forestLost / forestStart, 0, 1);
  const envTarget = clamp(92 - (pollution / Math.sqrt(areaKm2)) * 6 - (1 - forestShare) * 40 - (untreated / 1000) * 2 + (P.budget.environment - 1) * 8 + modSum('env'), 0, 100);
  st.env.quality = clamp(st.env.quality + (envTarget - st.env.quality) * 0.12, 0, 100);
  let marinePressure = (untreated / 400) * 1.5 + cruise / 6000 + live.filter((b) => ['aquaculture', 'pearl_farm'].includes(b.type)).length * (w.hasTech('aquaculture_sci') ? 1.2 : 2) + ports.length * 0.8 + pollution * 0.15;
  const fishFleets = live.filter((b) => b.type === 'fishing_fleet').length;
  marinePressure += fishFleets * 1.5;
  const marineTarget = clamp(95 - marinePressure * (sc.id === 'moorea' ? 1.6 : 1) + (P.budget.environment - 1) * 6 + (strictEnv ? 4 : 0) + modSum('marine'), 0, 100);
  const recov = 0.05 * (1 + w.techBonus('reef'));
  st.env.marine = clamp(st.env.marine + (marineTarget - st.env.marine) * (marineTarget > st.env.marine ? recov : 0.1), 0, 100);
  st.env.pollution = pollution;

  // ---------- inflation and prices
  const shortageTotal = RES_IDS.reduce((s, r) => s + (tradeResult.shortage[r] ?? 0) * RESOURCES[r].price, 0);
  const demandTotal = RES_IDS.reduce((s, r) => s + ((consumption[r] ?? 0) + (inputsNeed[r] ?? 0)) * RESOURCES[r].price, 0);
  const shortageRatio = demandTotal > 0 ? shortageTotal / demandTotal : 0;
  const gdpMonthPrev = prev?.gdp ?? Math.max(1, pop * 2000);
  const infl = monthlyInflation({ unemployment, shortage: shortageRatio, rentIndex: rentM, deficitRatio: -balance / Math.max(1, gdpMonthPrev), tariff: P.tariff, importShare: clamp(importValue / Math.max(1, gdpMonthPrev), 0, 1) });
  st.priceIndex *= 1 + infl;
  st.rentIndex = rentM;

  // ---------- GDP
  let gdp = 0;
  for (const v of Object.values(sectors)) gdp += v;
  gdp = Math.max(0, gdp);
  const hist = st.history;
  const last11 = hist.slice(-11).reduce((s, h) => s + h.gdp, 0);
  const gdpAnnual = last11 + gdp * (12 - Math.min(11, hist.length));
  const yearAgo = hist.length >= 12 ? hist[hist.length - 12] : null;
  const gdpGrowth = yearAgo && yearAgo.gdpAnnual > 0 ? gdpAnnual / yearAgo.gdpAnnual - 1 : prev && prev.gdpAnnual > 0 ? gdpAnnual / prev.gdpAnnual - 1 : 0;
  const inflAnnual = Math.pow(1 + infl, 12) - 1;

  // ---------- FDI
  const relAvg = st.countries.reduce((s, c) => s + c.relation * (c.traits.includes('investor') ? 1.5 : 1), 0) / Math.max(1, st.countries.length);
  let fdi = fdiInflow({ gdpAnnual, stability: st.stability, corporateTax: corpRate, portTier, reputation: st.reputation, relations: relAvg, approval: st.approval });
  fdi += st.modifiers.filter((m) => m.target === 'fdi' && m.value > 0).reduce((s, m) => s + m.value, 0);
  st.modifiers = st.modifiers.filter((m) => m.id !== 'fdi_mission');
  if (st.countries.length) {
    const inv = st.countries.filter((c) => c.relation > 0);
    for (const c of inv) c.investment += (fdi / Math.max(1, inv.length)) * 0.5;
  }

  // ---------- migration
  const costOfLiving = rentPerPerson * 2 + 900 * st.priceIndex * (1 + shortageRatio) * (0.7 + 0.3 * remoteEff);
  const servicesAvg = (services.education + services.health + services.safety + services.leisure + services.commerce) / 5 * (services.admin ? 1 : 0.7);
  const immMult = { closed: 0.15, restricted: 0.55, open: 1, skilled: 0.75 }[P.immigration];
  const mig = migration({
    pop, housing, unemployment, wage, costOfLiving, utilities: (powerSat + waterSat) / 2, services: servicesAvg, quality: (st.env.quality + st.approval) / 2,
    approval: st.approval, remoteness: remoteEff, policyMult: immMult * (P.housing === 'rent_control' ? 0.95 : 1), reputation: st.reputation, modifier: modSum('migration'),
  });
  const nat = naturalChange(pop);
  st.popFrac += nat.births - nat.deaths + mig.immigrants - mig.emigrants;
  const delta = Math.trunc(st.popFrac);
  st.popFrac -= delta;
  st.pop = Math.max(0, st.pop + delta);
  st.stats.peakPop = Math.max(st.stats.peakPop, st.pop);
  const homeless = st.pop > housing ? (st.pop - housing) / Math.max(1, st.pop) : 0;

  // ---------- approval & stability
  const taxBurden = P.incomeTax * 0.55 + P.salesTax * 0.3 + P.propertyTax * 4 + P.corporateTax * 0.1;
  const budgetAvg = (P.budget.education + P.budget.health + P.budget.safety + P.budget.infrastructure) / 4;
  // small communities expect fewer services
  const expect = clamp(pop / 400, 0.15, 1);
  const ap = approvalTarget({
    unemployment, rentIndex: rentM, taxBurden, services: servicesAvg + 0.55 * (1 - expect), servicesBudget: budgetAvg, env: (st.env.quality + st.env.marine) / 2,
    envWeight: sc.envWeight, inflation: inflAnnual, shortage: shortageRatio, power: powerSat, water: waterSat, homeless, modifier: modSum('approval'),
    scale: clamp(pop / 150, 0.25, 1),
  });
  if (pop < 30) ap.target = clamp(ap.target + 8, 0, 100); // a tiny community is forgiving
  st.approval = clamp(st.approval + (ap.target - st.approval) * 0.25, 0, 100);
  const debtRatio = st.debt / Math.max(1, gdpAnnual);
  const stabTarget = clamp(0.25 + st.approval / 120 - Math.max(0, debtRatio - 0.8) * 0.3 - st.disasters.length * 0.04 + modSum('stability'), 0, 1);
  st.stability = clamp(st.stability + (stabTarget - st.stability) * 0.2, 0, 1);
  st.creditRating = creditRating(debtRatio, st.stability);
  st.reputation = clamp(st.reputation + ((40 + st.env.quality * 0.25 + st.stability * 20 + st.countries.filter((c) => c.tradeDeal).length * 2) - st.reputation) * 0.05, 0, 100);

  // ---------- research
  const research = st.research;
  research.points = researchPts;
  if (research.current) {
    research.progress += researchPts;
    const tech = TECH_MAP[research.current];
    if (research.progress >= tech.cost) {
      research.completed.push(tech.id);
      research.progress -= tech.cost;
      research.current = null;
      w.notify('good', `Research complete: ${tech.name}`, tech.desc);
    }
  } else {
    research.progress = Math.min(research.progress + researchPts * 0.5, 500);
  }

  // ---------- regions, inequality, resilience
  const regionIncome: { pop: number; income: number }[] = [];
  for (const r of st.regions) r.stats = { pop: 0, jobs: 0, gdp: 0, income: 0, landValue: 0, housing: 0, buildings: 0 };
  for (const b of live) {
    const d = BUILDING_MAP[b.type];
    const r = st.regions[b.region];
    if (!r) continue;
    r.stats.buildings++;
    if (d.housing) {
      r.stats.housing += d.housing * b.condition;
      r.stats.pop += d.housing * b.condition * Math.min(1.06, pop / Math.max(1, housing));
    }
    r.stats.jobs += (b.ops?.workers ?? 0);
    r.stats.gdp += Math.max(0, (b.ops?.revenue ?? 0) * 0.6 + (b.ops?.workers ?? 0) * wage * 0.4);
  }
  for (const r of st.regions) {
    // residents commute: half of income is earned locally, half shared island-wide
    r.stats.income = r.stats.pop > 0 ? (r.stats.jobs / Math.max(1, r.stats.pop)) * wage * 0.5 + (employed / Math.max(1, pop)) * wage * 0.5 : 0;
    r.stats.landValue = Math.round(50 + (r.stats.gdp / Math.max(1, gdp)) * 100 + rentM * 20);
    regionIncome.push({ pop: r.stats.pop, income: r.stats.income });
  }
  const inequality = gini(regionIncome) * 0.6 + (P.housing === 'social' ? -0.03 : 0) + (P.incomeTax < 0.15 ? 0.04 : 0) + 0.18;
  const sectorHHI = herfindahl(Object.values(sectors));
  const regionHHI = herfindahl(st.regions.map((r) => r.stats.gdp));
  const resilience = clamp(1 - (sectorHHI * 0.6 + regionHHI * 0.4), 0, 1);

  // ---------- record
  const m: MonthRecord = {
    day: st.day, year: prevDate.year, month, pop: st.pop, births: nat.births, deaths: nat.deaths, immigrants: mig.immigrants, emigrants: mig.emigrants,
    housing, jobs, labour, employed, unemployment, wage, rent: rentPerPerson, rentIndex: rentM, priceIndex: st.priceIndex, inflation: inflAnnual,
    gdp, gdpAnnual, gdpGrowth, gdpPerCapita: pop > 0 ? gdpAnnual / pop : 0, sectors, revenue, expenditure, revenueItems, expenseItems, balance,
    treasury: st.treasury, debt: st.debt, interestRate: rate, exports: exportValue + (exportsBy.services ?? 0) + tourSpend, imports: importValue,
    exportsBy: { ...exportsBy, tourism: tourSpend }, importsBy, shortages: tradeResult.shortage, tradeCapacity: tradeCap, tradeUsed: tradeResult.used, fdi,
    tourists: Math.round(overnight + yachts + cruise), cruise: Math.round(cruise), powerSupply, powerDemand,
    renewableShare: powerSupply > 0 ? clamp(renewable / Math.max(powerSupply, 1e-6), 0, 1) : 0, waterSupply, waterDemand,
    approval: st.approval, approvalFactors: ap.factors, stability: st.stability, envQuality: st.env.quality, marine: st.env.marine, pollution,
    attractiveness: mig.attractiveness, migrationFactors: mig.factors, explain, research: researchPts, inequality: clamp(inequality, 0, 1), resilience,
    services: { ...services },
  };
  buildExplanations(w, m, prev, { powerSat, waterSat, tradeCap, shortageRatio, demand, bedCap });
  hist.push(m);
  if (hist.length > 360) hist.splice(0, hist.length - 360);

  // ---------- private development in zones, events, diplomacy, objectives
  growZones(w, m);
  updateRelations(w);
  maybeTriggerEvent(w);
  checkObjectives(w, m);
  st.monthAcc = { portClosedDays: 0, days: 0, windSum: 0, sunSum: 0, rainSum: 0, constructionSpend: 0, stormDays: 0, fogDays: 0 };
  w.computeRoadComponents();
}

function portCap(w: World, p: Building): number {
  const d = BUILDING_MAP[p.type];
  const u = p.upgrades ?? {};
  let c = d.port!.capacity * p.condition * (1 + 0.35 * (u.quay ?? 0)) * (1 + (u.rail_link ? 0.25 : 0)) * (1 + w.techBonus('port'));
  if (!u.utility_link) c *= 0.5;
  if (!u.customs && c > 20000) c = 20000 + (c - 20000) * 0.3;
  if (u.customs) c *= 1.15;
  // warehouses nearby
  for (const b of w.state.buildings) {
    if (b.type === 'warehouse' && b.status === 'active' && Math.hypot(b.x - p.x, b.z - p.z) < 450) c *= 1.2;
  }
  // too shallow (silted or not dredged) cuts big-ship access
  if ((p.depth ?? d.port!.minDepth) < d.port!.minDepth) c *= clamp((p.depth ?? 0) / d.port!.minDepth, 0.2, 1);
  if (w.roadStatus(p) === 'none') c *= 0.3;
  return c;
}

function portCapacity(w: World, ports: Building[]): number {
  return ports.reduce((s, p) => s + portCap(w, p), 0);
}

/** Decide exports and imports under a shared tonnage limit. Food and fuel imports come first, then high-value exports. */
export function allocateTrade(production: Partial<Record<ResId, number>>, consumption: Partial<Record<ResId, number>>, inputs: Partial<Record<ResId, number>>, capacity: number) {
  const exports: Partial<Record<ResId, number>> = {};
  const imports: Partial<Record<ResId, number>> = {};
  const shortage: Partial<Record<ResId, number>> = {};
  const wantImport: [ResId, number][] = [];
  const wantExport: [ResId, number][] = [];
  for (const r of RES_IDS) {
    const net = (production[r] ?? 0) - (consumption[r] ?? 0) - (inputs[r] ?? 0);
    if (net < -1e-9) wantImport.push([r, -net]);
    else if (net > 1e-9) wantExport.push([r, net]);
  }
  const prio = (r: ResId) => (r === 'food' ? 0 : r === 'fuel' ? 1 : 2);
  wantImport.sort((a, b) => prio(a[0]) - prio(b[0]));
  wantExport.sort((a, b) => RESOURCES[b[0]].price / RESOURCES[b[0]].tonnage - RESOURCES[a[0]].price / RESOURCES[a[0]].tonnage);
  let left = capacity;
  for (const [r, q] of wantImport) {
    const tons = q * RESOURCES[r].tonnage;
    const take = Math.min(tons, left);
    imports[r] = take / RESOURCES[r].tonnage;
    if (take < tons) shortage[r] = (tons - take) / RESOURCES[r].tonnage;
    left -= take;
  }
  for (const [r, q] of wantExport) {
    const tons = q * RESOURCES[r].tonnage;
    const take = Math.min(tons, left);
    exports[r] = take / RESOURCES[r].tonnage;
    left -= take;
  }
  return { exports, imports, shortage, used: capacity - left, capacity };
}

function serviceCoverage(w: World, live: Building[], road: Map<number, string>, staffing: number, pop: number) {
  const kinds = ['education', 'health', 'safety', 'leisure'] as const;
  const out: Record<string, number> = { education: 0, health: 0, safety: 0, leisure: 0, commerce: 0, admin: 0, transport: 0 };
  const homes = live.filter((b) => BUILDING_MAP[b.type].housing);
  const totalHomes = homes.reduce((s, b) => s + BUILDING_MAP[b.type].housing!, 0);
  const P = w.state.policy;
  const budget: Record<string, number> = { education: P.budget.education, health: P.budget.health, safety: P.budget.safety, leisure: P.budget.culture };
  for (const k of kinds) {
    const prov = live.filter((b) => BUILDING_MAP[b.type].service?.kind === k && road.get(b.id) !== 'none');
    if (!prov.length || !totalHomes) continue;
    let covered = 0;
    for (const h of homes) {
      if (prov.some((p) => Math.hypot(p.x - h.x, p.z - h.z) <= BUILDING_MAP[p.type].service!.radius)) covered += BUILDING_MAP[h.type].housing!;
    }
    const cap = prov.reduce((s, p) => s + BUILDING_MAP[p.type].service!.cap * p.condition, 0) * Math.min(1, staffing * 1.15) * budget[k] * (k === 'health' ? 1 + w.techBonus('health') : 1);
    out[k] = clamp(Math.min(covered / totalHomes, cap / Math.max(1, pop)), 0, 1);
  }
  const commerce = live.reduce((s, b) => s + (BUILDING_MAP[b.type].commerce ?? 0) * (road.get(b.id) !== 'none' ? b.condition : 0), 0);
  out.commerce = clamp((commerce * Math.min(1, staffing * 1.2)) / Math.max(1, pop), 0, 1);
  out.admin = live.some((b) => b.type === 'town_hall') ? 1 : 0;
  out.transport = live.some((b) => b.type === 'bus_depot') ? 1 : 0;
  return out as { education: number; health: number; safety: number; leisure: number; commerce: number; admin: number; transport: number };
}

function buildExplanations(w: World, m: MonthRecord, prev: MonthRecord | undefined, x: { powerSat: number; waterSat: number; tradeCap: number; shortageRatio: number; demand: number; bedCap: number }) {
  const e = m.explain;
  if (prev) {
    const dg = m.gdp - prev.gdp;
    if (Math.abs(dg) > prev.gdp * 0.03 && prev.gdp > 0) {
      const changes = Object.keys(m.sectors).map((k) => [k, (m.sectors[k] ?? 0) - (prev.sectors[k] ?? 0)] as [string, number]).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
      const top = changes.slice(0, 2).filter((c) => Math.abs(c[1]) > 1000).map((c) => `${c[0]} ${c[1] > 0 ? '+' : ''}${money(c[1])}`);
      if (top.length) e.push(`GDP ${dg > 0 ? 'rose' : 'fell'} ${Math.abs((dg / prev.gdp) * 100).toFixed(1)}% this month: ${top.join(', ')}.`);
    }
  }
  const net = Math.round(m.immigrants - m.emigrants);
  const mf = Object.entries(m.migrationFactors).sort((a, b) => b[1] - a[1]);
  if (net > 0) e.push(`${net} people moved in, drawn by ${mf.slice(0, 2).filter((f) => f[1] > 0).map((f) => f[0]).join(' and ') || 'the island'}.`);
  else if (net < 0) e.push(`${-net} people left: ${mf.slice(-2).filter((f) => f[1] < 0).map((f) => f[0]).join(' and ') || 'no prospects'}.`);
  else if (m.attractiveness > 0.05 && m.housing <= m.pop * 1.01) e.push('People want to move here but there are no vacant homes.');
  if (m.unemployment > 0.1) e.push(`Unemployment is high (${(m.unemployment * 100).toFixed(1)}%): create jobs.`);
  if (m.jobs > m.labour * 1.15 && m.pop > 0) e.push(`Businesses are short of ${Math.round(m.jobs - m.employed)} workers: build homes to attract residents.`);
  if (m.rentIndex > 1.4) e.push(`Rents are ${(m.rentIndex * 100 - 100).toFixed(0)}% above normal because housing is scarce.`);
  if (x.powerSat < 0.97 && m.powerDemand > 1e-4) e.push(`Power shortage: ${(m.powerDemand - m.powerSupply).toFixed(2)} MW missing.`);
  if (x.waterSat < 0.97 && m.waterDemand > 1) e.push(`Water shortage: ${Math.round(m.waterDemand - m.waterSupply).toLocaleString()} m³ short.`);
  if (x.shortageRatio > 0.02) e.push(`Imports are capped by port capacity (${Math.round(x.tradeCap).toLocaleString()} t): shortages push prices up.`);
  if (x.demand > x.bedCap * 1.2 && x.demand > 50) e.push(`${Math.round(x.demand - x.bedCap)} would-be visitors found no bed: build accommodation.`);
  if (m.balance < 0) e.push(`Budget deficit of ${money(-m.balance)}.`);
  const mo = MONTH_NAMES[m.month];
  if (w.scenario.tourismSeason[m.month] > 1.6) e.push(`${mo} is peak tourist season.`);
  else if (w.scenario.tourismSeason[m.month] < 0.3) e.push(`${mo} is the off-season: few visitors.`);
}

// ------------------------------------------------------------------ private zone growth

function pickZoneType(w: World, zone: ZoneId, landValue: number): string {
  const pop = w.state.pop;
  const opts: string[] = [];
  if (zone === 'R') {
    opts.push(landValue > 0.6 && pop > 200 ? 'terrace' : 'houses', 'cottage');
    if (pop > 500 && landValue > 0.55) opts.push('apartments', 'terrace');
    if (pop > 2500 && w.hasTech('highrise') && landValue > 0.7) opts.push('tower');
  } else if (zone === 'C') {
    opts.push('shop');
    if (pop > 500) opts.push('market');
    if (pop > 1200) opts.push('offices');
  } else {
    opts.push('workshop');
    if (pop > 700 && w.maxPortTier() >= 2) opts.push('factory');
  }
  return w.rng.pick(opts);
}

let zoneCellCache: { version: number; cells: Record<ZoneId, number[]> } | null = null;

function growZones(w: World, m: MonthRecord) {
  const st = w.state;
  const t = w.terrain;
  if (!zoneCellCache || zoneCellCache.version !== w.zonesVersion || zoneCellCache.cells.R.length + zoneCellCache.cells.C.length + zoneCellCache.cells.I.length === 0) {
    const cells: Record<ZoneId, number[]> = { R: [], C: [], I: [] };
    for (let k = 0; k < st.zones.length; k++) if (st.zones[k]) cells[ZONE_FROM_CODE[st.zones[k]]].push(k);
    zoneCellCache = { version: w.zonesVersion, cells };
  }
  const cells = zoneCellCache.cells;
  const vacant = m.housing * ECON.overcrowding - m.pop;
  const commerceCap = st.buildings.reduce((s, b) => s + (BUILDING_MAP[b.type].commerce ?? 0), 0);
  const demand: Record<ZoneId, number> = {
    R: Math.max(0, (m.attractiveness > 0 ? m.attractiveness * (14 + 0.035 * m.pop) * 3 : 0) + (m.jobs - m.employed) * 1.2 - Math.max(0, vacant)) * (st.policy.housing === 'rent_control' ? 0.5 : 1),
    C: Math.max(0, m.pop * 1.15 - commerceCap) / 200,
    I: Math.max(0, (m.unemployment - 0.05) * m.labour) / 20 + m.fdi / 4_000_000,
  };
  const underway = st.buildings.filter((b) => b.owner === 'private' && b.status === 'construction');
  const maxNew = Math.max(1, Math.min(8, Math.round(1 + m.pop / 500)));
  let built = 0;
  for (const z of ['R', 'C', 'I'] as ZoneId[]) {
    const list = cells[z];
    if (!list.length) continue;
    const unitsUnderway = underway.filter((b) => BUILDING_MAP[b.type].zone === z).reduce((s, b) => s + (BUILDING_MAP[b.type].housing ?? 1), 0);
    let need = z === 'R' ? demand.R - unitsUnderway : demand[z] - underway.filter((b) => BUILDING_MAP[b.type].zone === z).length;
    let tries = 0;
    while (need > 0.3 && built < maxNew && tries < 40) {
      tries++;
      const k = list[w.rng.int(0, list.length - 1)];
      const [x, zz] = t.toWorld(k % t.W, Math.floor(k / t.W));
      const near = w.nearestRoad(x, zz, 70, false);
      if (!near.road || near.dist > 55) continue;
      // set the building back from the road, facing it
      let px = x, pz = zz;
      {
        const pts = near.road.pts;
        let bd = Infinity;
        for (let i = 0; i + 1 < pts.length; i++) {
          const [ax, az] = pts[i];
          const [bx, bz] = pts[i + 1];
          const ddx = bx - ax, ddz = bz - az;
          const l2 = ddx * ddx + ddz * ddz;
          const tt = l2 > 0 ? clamp(((x - ax) * ddx + (zz - az) * ddz) / l2, 0, 1) : 0;
          const qx = ax + tt * ddx, qz = az + tt * ddz;
          const d = Math.hypot(qx - x, qz - zz);
          if (d < bd) (bd = d), (px = qx), (pz = qz);
        }
      }
      let dirX = x - px, dirZ = zz - pz;
      const dl = Math.hypot(dirX, dirZ);
      if (dl < 1e-3) continue;
      dirX /= dl;
      dirZ /= dl;
      const lv = clamp(0.3 + (st.buildings.filter((b) => Math.hypot(b.x - x, b.z - zz) < 300).length / 12) + (t.coastDistAt(x, zz) < 300 ? 0.15 : 0), 0, 1);
      const type = pickZoneType(w, z, lv);
      const def = BUILDING_MAP[type];
      const setback = def.size[1] / 2 + (near.road.cls === 'avenue' ? 7 : near.road.cls === 'road' ? 5 : 3) + 2;
      const dx = px + dirX * setback, dz = pz + dirZ * setback;
      const rot = Math.atan2(-dirX, -dirZ);
      if (st.zones[t.idx(dx, dz)] !== st.zones[k]) continue;
      const res = w.evaluate(type, dx, dz, rot);
      const blocking = res.errors.filter((e) => !e.startsWith('Costs'));
      if (blocking.length) continue;
      if (res.checks.find((c) => c.label === 'Road access')?.state !== 'ok') continue;
      w.placeBuilding(type, dx, dz, rot, { free: true, owner: 'private', force: true });
      built++;
      need -= z === 'R' ? def.housing ?? 1 : 1;
    }
  }
}

// ------------------------------------------------------------------ objectives

export function objectiveProgress(w: World, o: { kind: string; target: number; ref?: string }, m: MonthRecord | undefined): number {
  const st = w.state;
  switch (o.kind) {
    case 'pop':
      return st.pop / o.target;
    case 'building':
      return st.buildings.filter((b) => b.type === o.ref && b.status !== 'construction').length / o.target;
    case 'gdpPerCapita':
      return (m?.gdpPerCapita ?? 0) / o.target;
    case 'approval':
      return st.approval / o.target;
    case 'env':
      return st.history.length >= 12 ? st.env.quality / o.target : Math.min(0.99, st.env.quality / o.target);
    case 'export':
      return (st.exportsTotal[o.ref as ResId] ?? 0) / o.target;
    case 'portTier':
      return w.maxPortTier() / o.target;
    case 'surplusMonths':
      return st.surplusStreak / o.target;
    case 'marine':
      return st.history.length >= 24 ? st.env.marine / o.target : Math.min(0.99, st.env.marine / o.target);
    case 'tourists':
      return (m?.tourists ?? 0) / o.target;
    case 'research':
      return st.research.completed.length / o.target;
    case 'unemploymentBelow':
      return m && m.pop > 50 ? Math.min(1, o.target / Math.max(0.0001, m.unemployment)) : 0;
    case 'renewableShare':
      return m && m.powerSupply > 0.2 ? m.renewableShare / o.target : 0;
    case 'forest':
      return st.history.length >= 24 ? clamp(1 - st.env.forestLost / Math.max(1, st.env.forestStart), 0, 1) / o.target : 0.5;
    case 'water':
      return (m?.waterSupply ?? 0) / o.target;
    case 'debtRatioBelow':
      return m ? Math.min(1, o.target / Math.max(0.0001, st.debt / Math.max(1, m.gdpAnnual))) : 0;
  }
  return 0;
}

function checkObjectives(w: World, m: MonthRecord) {
  const st = w.state;
  for (const o of w.scenario.objectives) {
    if (st.objectives[o.id] != null) continue;
    if (objectiveProgress(w, o, m) >= 1) {
      st.objectives[o.id] = st.day;
      if (o.reward) st.treasury += o.reward;
      w.notify('good', `Objective complete: ${o.text}`, o.reward ? `Reward: ${money(o.reward)} development grant.` : undefined);
    }
  }
  if (!st.scenarioComplete && w.scenario.objectives.every((o) => st.objectives[o.id] != null)) {
    st.scenarioComplete = true;
    w.notify('good', 'Scenario complete!', 'Every objective is met. Keep building: the island is yours to shape.');
  }
}

export { MASK };
