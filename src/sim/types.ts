// Serializable game state. Everything the simulation needs to continue lives here, so a save is just this object.

import type { ResId, ZoneId } from '../data/catalogue';
import type { Style } from '../data/styles';
import type { DisasterKind } from '../data/scenarios';

export const SAVE_VERSION = 4;

export interface FlagSpec {
  pattern: 'tricolour-v' | 'tricolour-h' | 'cross' | 'canton' | 'diagonal' | 'circle' | 'chevron';
  colors: [string, string, string];
  emblem: 'none' | 'star' | 'sun' | 'wave' | 'mountain' | 'fish';
}

export type BuildingStatus = 'construction' | 'active' | 'damaged';

export interface BuildingOps {
  workers: number;
  jobs: number;
  staffing: number; // 0..1
  power: number; // satisfaction 0..1
  water: number;
  road: boolean;
  efficiency: number; // overall 0..1
  output: Partial<Record<ResId, number>>;
  revenue: number; // monthly operating revenue
  profit: number;
  issues: string[];
}

export interface Building {
  id: number;
  type: string;
  x: number;
  z: number;
  rot: number; // radians
  style: Style;
  status: BuildingStatus;
  progress: number; // 0..1 while under construction
  startDay: number;
  doneDay: number;
  condition: number; // 0..1, damage lowers it
  owner: 'state' | 'private' | 'community';
  region: number;
  cost: number; // what was paid
  // ports
  upgrades?: Record<string, number>; // upgrade id -> count completed
  pending?: { id: string; progress: number; days: number }[]; // upgrades under construction
  depth?: number; // real metres at the berth (after dredging)
  shelter?: number; // 0..1
  // runtime results of the last monthly update (saved too; harmless and useful for the UI on load)
  ops?: BuildingOps;
  consultDays?: number; // community consultation remaining
}

export interface RoadSeg {
  id: number;
  cls: 'track' | 'road' | 'avenue';
  pts: [number, number][]; // world x/z polyline
  length: number;
  progress: number; // 0..1
  status: 'construction' | 'active';
  osm?: boolean; // pre-existing real road
  cost: number;
}

export interface Policy {
  incomeTax: number;
  corporateTax: number;
  salesTax: number;
  tourismTax: number;
  propertyTax: number;
  tariff: number;
  budget: { education: number; health: number; safety: number; infrastructure: number; environment: number; culture: number };
  housing: 'market' | 'rent_control' | 'social';
  immigration: 'closed' | 'restricted' | 'open' | 'skilled';
  environment: 'lax' | 'balanced' | 'strict';
  energy: 'fossil' | 'mixed' | 'green';
  maxDebtRatio: number; // borrowing limit as a share of annual GDP
  autoBorrow: boolean;
  style: Style; // default architecture for new private buildings
  regionFocus: number; // -1 = balanced development
}

export interface Country {
  id: string;
  name: string;
  adjective: string;
  flag: FlagSpec;
  gdp: number; // relative economic size (1 = average)
  distance: number; // 0..1 (far)
  relation: number; // -100..100
  traits: ('eco' | 'trade' | 'tourism' | 'investor' | 'protectionist')[];
  tradeDeal: boolean;
  theirTariff: number;
  tourismShare: number; // share of visitors from this country
  investment: number; // cumulative FDI ($)
  campaign: number; // months left of tourism campaign
  lastAction: number; // day of last diplomatic action
  wants: ResId[]; // goods they import eagerly
}

export interface WeatherDay {
  temp: number;
  rain: number; // mm
  wind: number; // m/s
  windDir: number; // radians, direction wind blows FROM
  cloud: number; // 0..1
  fog: number; // 0..1
  storm: boolean;
  kind: 'clear' | 'cloudy' | 'rain' | 'storm' | 'fog';
}

export interface Notification {
  id: number;
  day: number;
  kind: 'info' | 'good' | 'warn' | 'bad' | 'event';
  title: string;
  text?: string;
  at?: [number, number]; // world position to fly to
  read?: boolean;
}

export interface EventChoice {
  label: string;
  desc: string;
}

export interface PendingEvent {
  id: string; // event def id
  uid: number;
  day: number;
  title: string;
  text: string;
  choices: EventChoice[];
  data?: Record<string, any>;
}

export interface ActiveDisaster {
  kind: DisasterKind;
  start: number;
  days: number; // remaining
  severity: number; // 0..1
  at?: [number, number];
  radius?: number;
}

export interface Modifier {
  id: string;
  label: string;
  target: 'approval' | 'tourism' | 'productivity' | 'fdi' | 'migration' | 'marine' | 'env' | 'stability' | 'construction';
  value: number;
  until: number; // day
}

export interface Region {
  id: number;
  name: string;
  seed: [number, number]; // world x/z
  style?: Style;
  stats: { pop: number; jobs: number; gdp: number; income: number; landValue: number; housing: number; buildings: number };
}

export interface MonthRecord {
  day: number;
  year: number;
  month: number;
  pop: number;
  births: number;
  deaths: number;
  immigrants: number;
  emigrants: number;
  housing: number;
  jobs: number;
  labour: number;
  employed: number;
  unemployment: number;
  wage: number;
  rent: number; // monthly rent per household-person index ($)
  rentIndex: number;
  priceIndex: number;
  inflation: number; // annualised
  gdp: number; // monthly
  gdpAnnual: number; // trailing 12 months
  gdpGrowth: number; // year on year
  gdpPerCapita: number; // annualised
  sectors: Record<string, number>;
  revenue: number;
  expenditure: number;
  revenueItems: Record<string, number>;
  expenseItems: Record<string, number>;
  balance: number;
  treasury: number;
  debt: number;
  interestRate: number;
  exports: number;
  imports: number;
  exportsBy: Partial<Record<ResId | 'services' | 'tourism', number>>;
  importsBy: Partial<Record<ResId, number>>;
  shortages: Partial<Record<ResId, number>>;
  tradeCapacity: number;
  tradeUsed: number;
  fdi: number;
  tourists: number;
  cruise: number;
  powerSupply: number;
  powerDemand: number;
  renewableShare: number;
  waterSupply: number;
  waterDemand: number;
  approval: number;
  approvalFactors: Record<string, number>;
  stability: number;
  envQuality: number;
  marine: number;
  pollution: number;
  attractiveness: number;
  migrationFactors: Record<string, number>;
  explain: string[];
  research: number;
  inequality: number;
  resilience: number;
  services: Record<string, number>; // coverage 0..1
}

export interface GameState {
  version: number;
  seed: number;
  rng: number;
  scenario: string;
  nation: { name: string; flag: FlagSpec; motto: string; currency: string };
  day: number; // days since 1 January of startYear
  startYear: number;
  treasury: number;
  debt: number;
  creditRating: string;
  buildings: Building[];
  roads: RoadSeg[];
  nextId: number;
  zones: Uint8Array; // per terrain cell: 0 none, 1 R, 2 C, 3 I
  cleared: Uint8Array; // per terrain cell: vegetation removed (1)
  pop: number;
  popFrac: number;
  policy: Policy;
  research: { completed: string[]; current: string | null; progress: number; points: number };
  countries: Country[];
  reputation: number;
  approval: number;
  stability: number;
  env: { quality: number; marine: number; pollution: number; forestStart: number; forestLost: number };
  priceIndex: number;
  wageLevel: number;
  rentIndex: number;
  weather: WeatherDay;
  weatherHistory: { rain: number; dryDays: number; stormDays: number; constructionLoss: number };
  monthAcc: { portClosedDays: number; days: number; windSum: number; sunSum: number; rainSum: number; constructionSpend: number; stormDays: number; fogDays: number };
  history: MonthRecord[];
  regions: Region[];
  notifications: Notification[];
  nextNote: number;
  pendingEvents: PendingEvent[];
  eventLog: { day: number; title: string; choice: string }[];
  disasters: ActiveDisaster[];
  modifiers: Modifier[];
  objectives: Record<string, number>; // id -> day completed
  surplusStreak: number;
  exportsTotal: Partial<Record<ResId, number>>;
  stats: { builtCount: number; disasterCount: number; touristsTotal: number; peakPop: number };
  tutorialStep: number;
  scenarioComplete: boolean;
  lastAutosaveDay: number;
  /** Pre-existing local economy of the starting population (generators, wells, jobs not modelled as buildings). */
  legacy: { power: number; water: number; jobs: number };
}

export function emptyOps(): BuildingOps {
  return { workers: 0, jobs: 0, staffing: 0, power: 1, water: 1, road: false, efficiency: 0, output: {}, revenue: 0, profit: 0, issues: [] };
}

export type ZoneGridId = ZoneId;
