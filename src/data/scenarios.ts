// The five real-world starting locations. Terrain comes from public/data/<id>/ (real DEM + OSM); everything
// here is gameplay framing. All scenarios are fictional development stories, not real plans or offers.

import type { Style } from './styles';

export type DisasterKind = 'storm' | 'cyclone' | 'drought' | 'wildfire' | 'earthquake' | 'landslide' | 'bleaching' | 'algal_bloom';

export interface Climate {
  temp: number[]; // mean daily temperature by month (degC)
  rain: number[]; // probability of a wet day
  wind: number[]; // mean wind speed (m/s)
  storm: number[]; // probability of a storm day
  fog: number[]; // probability of fog
  sun: number[]; // sunshine fraction
  windDir: number[]; // frequency of wind FROM N, NE, E, SE, S, SW, W, NW
}

export type ObjectiveKind =
  | 'pop' | 'building' | 'gdpPerCapita' | 'approval' | 'env' | 'export' | 'portTier' | 'surplusMonths'
  | 'marine' | 'tourists' | 'research' | 'water' | 'unemploymentBelow' | 'renewableShare' | 'forest' | 'debtRatioBelow';

export interface Objective {
  id: string;
  text: string;
  kind: ObjectiveKind;
  target: number;
  ref?: string; // building id or resource id
  reward?: number; // grant on completion
}

export interface StartBuilding {
  type: string;
  p: [number, number]; // grid units
  rot?: number;
}

export interface Scenario {
  id: string;
  name: string;
  country: string;
  tagline: string;
  intro: string;
  difficulty: string[];
  difficultyLevel: 1 | 2 | 3 | 4 | 5;
  ethics?: string;
  climate: Climate;
  tourismSeason: number[];
  tourismBase: number; // potential visitors per month at appeal 1
  touristSpend: number; // $ per visitor
  style: Style;
  vegetation: 'temperate' | 'mediterranean' | 'rainforest' | 'tropical';
  startPop: number;
  startFunds: number;
  startDebt: number;
  baseWage: number;
  remoteness: number; // import cost multiplier before access improvements
  groundwater: number; // borehole output multiplier
  ferryCapacity: number; // tonnes per month before any port is built
  envWeight: number; // how strongly residents and visitors care about the environment
  marineName: string; // 'Reef health', 'Seabed & kelp health', ...
  disasters: { kind: DisasterKind; p: number; season?: number[] }[];
  regionCount: number;
  regionNames: string[]; // fallbacks when no OSM place is close
  regionAnchors?: [number, number][]; // grid positions for each named region (used as k-means seeds)
  landmark?: { name: string; p: [number, number]; desc: string };
  startBuildings: StartBuilding[];
  startFromOsmHousing?: boolean; // place starting homes on real OSM building locations
  objectives: Objective[];
  foreignNames: string[]; // flavour for the neighbour land that is not part of the territory
}

const M = (...v: number[]) => v;

export const SCENARIOS: Scenario[] = [
  {
    id: 'shuna',
    name: 'Shuna Island',
    country: 'Slate Islands, Argyll, Scotland',
    tagline: 'Restore a historic island estate on the edge of the Atlantic.',
    intro:
      'A 4.5 km island of rough pasture, low hills and quiet coves between Luing and the Argyll mainland. The Edwardian castle and its farms have seen better days, and a dozen estate staff live here. Restore the estate, open a harbour and build a small, prosperous island community.',
    difficulty: ['Remote: every import arrives by boat', 'Atlantic gales close the sea for days', 'Little flat land between rocky knolls'],
    difficultyLevel: 2,
    climate: {
      temp: M(5, 5, 6, 8, 11, 13, 15, 15, 13, 10, 7, 5),
      rain: M(0.62, 0.56, 0.55, 0.45, 0.42, 0.45, 0.48, 0.52, 0.55, 0.6, 0.63, 0.63),
      wind: M(9, 8.5, 8, 7, 6.5, 6, 6, 6.5, 7.5, 8.5, 9, 9.5),
      storm: M(0.06, 0.05, 0.04, 0.02, 0.01, 0.005, 0.005, 0.01, 0.02, 0.04, 0.05, 0.07),
      fog: M(0.05, 0.05, 0.06, 0.06, 0.07, 0.06, 0.06, 0.06, 0.06, 0.05, 0.05, 0.05),
      sun: M(0.18, 0.25, 0.3, 0.4, 0.45, 0.42, 0.38, 0.36, 0.32, 0.26, 0.2, 0.16),
      windDir: [0.07, 0.04, 0.05, 0.1, 0.16, 0.25, 0.2, 0.13],
    },
    tourismSeason: M(0.3, 0.3, 0.45, 0.7, 1, 1.3, 1.6, 1.6, 1.1, 0.6, 0.35, 0.35),
    tourismBase: 650,
    touristSpend: 620,
    style: 'european',
    vegetation: 'temperate',
    startPop: 12,
    startFunds: 42_000_000,
    startDebt: 0,
    baseWage: 3600,
    remoteness: 1.18,
    groundwater: 1.0,
    ferryCapacity: 140,
    envWeight: 1,
    marineName: 'Seabed & kelp health',
    disasters: [
      { kind: 'storm', p: 0.07, season: M(1.6, 1.4, 1.1, 0.6, 0.3, 0.2, 0.2, 0.3, 0.7, 1.2, 1.5, 1.8) },
      { kind: 'algal_bloom', p: 0.015, season: M(0, 0, 0.3, 0.8, 1.5, 2, 2, 1.8, 1, 0.3, 0, 0) },
    ],
    regionCount: 3,
    regionNames: ['North End', 'Druim Mor', 'South Point'],
    regionAnchors: [[205, 150], [165, 230], [135, 330]],
    landmark: { name: 'Shuna Castle', p: [203.5, 146.5], desc: 'An Edwardian baronial house built in 1911 on the north of the island.' },
    startBuildings: [
      { type: 'cottage', p: [182.7, 163.8] },
      { type: 'cottage', p: [211.2, 148.7] },
      { type: 'sheep_farm', p: [130.5, 275.5] },
    ],
    objectives: [
      { id: 'harbour', text: 'Open a harbour or port', kind: 'portTier', target: 1, reward: 1_500_000 },
      { id: 'castle', text: 'Restore Shuna Castle', kind: 'building', ref: 'heritage_restoration', target: 1, reward: 2_000_000 },
      { id: 'whisky', text: 'Export 20 t of island whisky', kind: 'export', ref: 'whisky', target: 20, reward: 1_000_000 },
      { id: 'pop', text: 'Grow to 400 residents', kind: 'pop', target: 400, reward: 2_500_000 },
      { id: 'green', text: 'Generate 60% of power from renewables', kind: 'renewableShare', target: 0.6 },
      { id: 'gdppc', text: 'Reach $45,000 GDP per person', kind: 'gdpPerCapita', target: 45_000 },
      { id: 'env', text: 'Keep environment quality at 70 or more', kind: 'env', target: 70 },
    ],
    foreignNames: ['Luing', 'Argyll mainland', 'Torsa'],
  },
  {
    id: 'makri',
    name: 'Makri Island',
    country: 'Echinades, Ionian Sea, Greece',
    tagline: 'Turn a bare limestone ridge into a sustainable Mediterranean resort island.',
    intro:
      'A narrow, uninhabited ridge of limestone and maquis in the Echinades, off the Acheloos delta. There is no water, no harbour and no town, only sun, clear sea and scrub. Build a resort economy that survives the off-season, the summer drought and the Natura 2000 rules that protect these islands.',
    difficulty: ['No freshwater: every litre must be pumped, caught or desalinated', 'Tourism collapses in winter', 'Very little buildable land', 'Protected marine and bird habitats'],
    difficultyLevel: 4,
    climate: {
      temp: M(11, 11, 13, 16, 20, 24, 27, 27, 24, 19, 15, 12),
      rain: M(0.35, 0.3, 0.28, 0.2, 0.12, 0.05, 0.02, 0.03, 0.1, 0.25, 0.35, 0.38),
      wind: M(5.5, 5.5, 5, 4.5, 4, 4, 4.5, 4.5, 4, 4.5, 5, 5.5),
      storm: M(0.02, 0.02, 0.01, 0.005, 0, 0, 0, 0, 0.005, 0.01, 0.02, 0.02),
      fog: M(0.02, 0.02, 0.02, 0.01, 0.01, 0, 0, 0, 0.01, 0.01, 0.02, 0.02),
      sun: M(0.45, 0.5, 0.55, 0.62, 0.72, 0.82, 0.88, 0.86, 0.75, 0.6, 0.48, 0.42),
      windDir: [0.12, 0.05, 0.04, 0.08, 0.1, 0.1, 0.18, 0.33],
    },
    tourismSeason: M(0.1, 0.1, 0.2, 0.5, 1, 1.7, 2.4, 2.5, 1.4, 0.5, 0.15, 0.1),
    tourismBase: 1100,
    touristSpend: 980,
    style: 'mediterranean',
    vegetation: 'mediterranean',
    startPop: 6,
    startFunds: 38_000_000,
    startDebt: 0,
    baseWage: 2400,
    remoteness: 1.12,
    groundwater: 0.35,
    ferryCapacity: 70,
    envWeight: 1.4,
    marineName: 'Seagrass & marine health',
    disasters: [
      { kind: 'drought', p: 0.05, season: M(0, 0, 0, 0.3, 1, 2, 2.6, 2.6, 1.4, 0.3, 0, 0) },
      { kind: 'wildfire', p: 0.035, season: M(0, 0, 0, 0.2, 0.6, 1.6, 2.8, 3, 1.6, 0.4, 0, 0) },
      { kind: 'earthquake', p: 0.003 },
      { kind: 'storm', p: 0.02, season: M(1.8, 1.6, 1, 0.5, 0, 0, 0, 0, 0.3, 1, 1.6, 2) },
    ],
    regionCount: 3,
    regionNames: ['North Ridge', 'Middle Saddle', 'South Point & Islet'],
    regionAnchors: [[150, 170], [235, 285], [335, 370]],
    startBuildings: [{ type: 'cottage', p: [258, 298] }],
    objectives: [
      { id: 'water', text: 'Secure 15,000 m³ of water a month', kind: 'water', target: 15000, reward: 1_000_000 },
      { id: 'marina', text: 'Open a marina or harbour', kind: 'portTier', target: 1, reward: 1_000_000 },
      { id: 'tourists', text: 'Welcome 3,000 visitors in a month', kind: 'tourists', target: 3000, reward: 2_000_000 },
      { id: 'pop', text: 'Grow to 250 year-round residents', kind: 'pop', target: 250, reward: 2_000_000 },
      { id: 'marine', text: 'Keep marine health above 75', kind: 'marine', target: 75 },
      { id: 'surplus', text: 'Run a budget surplus for 12 months in a row', kind: 'surplusMonths', target: 12 },
    ],
    foreignNames: ['Echinades', 'Aetolia-Acarnania coast'],
  },
  {
    id: 'lastovo',
    name: 'Lastovo',
    country: 'Dubrovnik-Neretva, Croatia',
    tagline: 'Grow a compact Adriatic island economy without losing what makes it special.',
    intro:
      'A limestone island of steep wooded hills, terraced valleys and 46 islets in the open Adriatic, home to under a thousand people in Lastovo town, Ubli and a few hamlets. Young people leave for the mainland. Create jobs and homes they can afford, in a place where every flat field is precious and the whole archipelago is a nature park.',
    difficulty: ['Very little buildable land', 'Long hilly roads between settlements', 'Housing affordability: holiday homes push rents up', 'Nature park rules'],
    difficultyLevel: 3,
    climate: {
      temp: M(9, 9, 11, 14, 18, 22, 25, 25, 21, 17, 13, 10),
      rain: M(0.35, 0.32, 0.32, 0.28, 0.2, 0.12, 0.07, 0.1, 0.2, 0.3, 0.38, 0.38),
      wind: M(6, 6, 5.5, 5, 4.5, 4, 4, 4, 4.5, 5.5, 6, 6.5),
      storm: M(0.03, 0.03, 0.02, 0.01, 0.005, 0, 0, 0.005, 0.01, 0.02, 0.03, 0.03),
      fog: M(0.02, 0.02, 0.02, 0.02, 0.01, 0.01, 0, 0, 0.01, 0.02, 0.02, 0.02),
      sun: M(0.4, 0.45, 0.5, 0.58, 0.68, 0.77, 0.85, 0.82, 0.7, 0.55, 0.42, 0.38),
      windDir: [0.1, 0.22, 0.08, 0.2, 0.1, 0.06, 0.1, 0.14],
    },
    tourismSeason: M(0.15, 0.15, 0.25, 0.55, 0.9, 1.6, 2.3, 2.4, 1.3, 0.5, 0.2, 0.15),
    tourismBase: 2600,
    touristSpend: 720,
    style: 'mediterranean',
    vegetation: 'mediterranean',
    startPop: 780,
    startFunds: 55_000_000,
    startDebt: 8_000_000,
    baseWage: 2300,
    remoteness: 1.2,
    groundwater: 0.45,
    ferryCapacity: 600,
    envWeight: 1.2,
    marineName: 'Marine park health',
    disasters: [
      { kind: 'drought', p: 0.035, season: M(0, 0, 0, 0.2, 0.8, 1.8, 2.6, 2.6, 1.2, 0.3, 0, 0) },
      { kind: 'wildfire', p: 0.03, season: M(0, 0, 0, 0.2, 0.6, 1.6, 2.8, 3, 1.5, 0.4, 0, 0) },
      { kind: 'storm', p: 0.025, season: M(1.8, 1.6, 1.2, 0.6, 0.2, 0, 0, 0.2, 0.5, 1, 1.6, 2) },
      { kind: 'earthquake', p: 0.002 },
    ],
    regionCount: 4,
    regionNames: ['Lastovo town', 'Ubli & Pasadur', 'Skrivena Luka', 'Eastern bays'],
    regionAnchors: [[357, 121], [110, 190], [320, 254], [470, 170]],
    landmark: { name: 'Kaštel fortress', p: [363.2, 113.5], desc: 'The early-19th-century fort on the hill above Lastovo town.' },
    startBuildings: [
      { type: 'small_harbour', p: [108.5, 214.5] },
      { type: 'town_hall', p: [357.5, 121.0] },
      { type: 'school', p: [352, 126] },
      { type: 'clinic', p: [360, 128] },
      { type: 'shop', p: [362, 122] },
      { type: 'shop', p: [118, 222] },
      { type: 'diesel_generator', p: [140, 205] },
      { type: 'well', p: [300, 170] },
      { type: 'well', p: [250, 150] },
      { type: 'rain_tank', p: [340, 140] },
      { type: 'vineyard', p: [300, 150] },
      { type: 'olive_grove', p: [230, 160] },
      { type: 'fishing_fleet', p: [111, 221] },
      { type: 'guesthouse', p: [350, 115] },
      { type: 'guesthouse', p: [122, 228] },
      { type: 'guesthouse', p: [318, 262] },
    ],
    startFromOsmHousing: true,
    objectives: [
      { id: 'port', text: 'Choose and build a commercial or cruise port', kind: 'portTier', target: 2, reward: 3_000_000 },
      { id: 'pop', text: 'Grow to 1,500 residents', kind: 'pop', target: 1500, reward: 3_000_000 },
      { id: 'unemp', text: 'Bring unemployment below 6%', kind: 'unemploymentBelow', target: 0.06 },
      { id: 'kastel', text: 'Restore the Kaštel fortress', kind: 'building', ref: 'heritage_restoration', target: 1, reward: 1_500_000 },
      { id: 'marine', text: 'Keep marine park health above 80', kind: 'marine', target: 80 },
      { id: 'gdppc', text: 'Reach $32,000 GDP per person', kind: 'gdpPerCapita', target: 32_000 },
    ],
    foreignNames: ['Lastovnjaci islets', 'Sušac'],
  },
  {
    id: 'guafo',
    name: 'Isla Guafo',
    country: 'Los Lagos, Chile',
    tagline: 'A fictional, conservation-first settlement on a wild rainforest island.',
    intro:
      'A 200 km² island of temperate rainforest, peat bog and sea cliffs at the mouth of the Gulf of Corcovado, home to one of the world’s largest sooty shearwater colonies, sea lions and blue whale feeding grounds. Only the lighthouse keepers live here. This is a fictional development scenario: build a small research and eco-tourism settlement that pays its way without destroying what makes Guafo extraordinary.',
    difficulty: ['Extreme logistics: the nearest port is a day away', 'Roaring Forties weather: rain most days, frequent storms', 'Steep, boggy, forested terrain', 'Strict conservation expectations'],
    difficultyLevel: 5,
    ethics: 'Isla Guafo is a real and ecologically important place. Nationforge treats it as a fictional scenario that rewards conservation; nothing here suggests the island is or should be for sale.',
    climate: {
      temp: M(12, 12, 11, 10, 8.5, 7, 6.5, 7, 8, 9, 10, 11),
      rain: M(0.6, 0.58, 0.65, 0.72, 0.8, 0.82, 0.8, 0.78, 0.7, 0.68, 0.62, 0.6),
      wind: M(9, 8.5, 9, 10, 11, 11.5, 11, 11, 10.5, 10, 9.5, 9),
      storm: M(0.03, 0.03, 0.04, 0.06, 0.08, 0.09, 0.09, 0.08, 0.06, 0.05, 0.04, 0.03),
      fog: M(0.08, 0.08, 0.09, 0.1, 0.1, 0.1, 0.1, 0.1, 0.09, 0.08, 0.08, 0.08),
      sun: M(0.4, 0.4, 0.33, 0.25, 0.18, 0.15, 0.16, 0.2, 0.26, 0.32, 0.36, 0.4),
      windDir: [0.08, 0.03, 0.02, 0.04, 0.1, 0.15, 0.3, 0.28],
    },
    tourismSeason: M(1.4, 1.3, 1, 0.6, 0.3, 0.2, 0.2, 0.3, 0.5, 0.8, 1.1, 1.4),
    tourismBase: 220,
    touristSpend: 1500,
    style: 'rural',
    vegetation: 'rainforest',
    startPop: 4,
    startFunds: 48_000_000,
    startDebt: 0,
    baseWage: 1900,
    remoteness: 1.5,
    groundwater: 1.3,
    ferryCapacity: 50,
    envWeight: 1.8,
    marineName: 'Marine wildlife health',
    disasters: [
      { kind: 'storm', p: 0.09, season: M(0.5, 0.5, 0.8, 1.1, 1.5, 1.7, 1.7, 1.5, 1.1, 0.9, 0.7, 0.5) },
      { kind: 'earthquake', p: 0.008 },
      { kind: 'landslide', p: 0.02, season: M(0.6, 0.6, 0.8, 1.1, 1.5, 1.6, 1.6, 1.4, 1, 0.8, 0.7, 0.6) },
      { kind: 'algal_bloom', p: 0.012, season: M(2, 2, 1.5, 0.6, 0, 0, 0, 0, 0.3, 0.8, 1.5, 2) },
    ],
    regionCount: 4,
    regionNames: ['Lighthouse coast', 'Northern forest', 'Southern bogs', 'Eastern shore'],
    regionAnchors: [[110, 200], [290, 150], [230, 390], [470, 270]],
    landmark: { name: 'Faro Isla Guafo', p: [80.5, 189.5], desc: 'The island’s lighthouse station (1907) on its exposed western headland.' },
    startBuildings: [{ type: 'cottage', p: [86, 192] }],
    objectives: [
      { id: 'harbour', text: 'Build a sheltered harbour', kind: 'portTier', target: 1, reward: 2_000_000 },
      { id: 'forest', text: 'Keep at least 90% of the forest standing', kind: 'forest', target: 0.9 },
      { id: 'research', text: 'Complete 6 research projects', kind: 'research', target: 6, reward: 2_000_000 },
      { id: 'pop', text: 'Grow to 150 residents', kind: 'pop', target: 150, reward: 2_000_000 },
      { id: 'marine', text: 'Keep marine wildlife health above 85', kind: 'marine', target: 85 },
      { id: 'green', text: 'Run on 90% renewable power', kind: 'renewableShare', target: 0.9 },
    ],
    foreignNames: [],
  },
  {
    id: 'moorea',
    name: "Mo'orea",
    country: 'Windward Islands, French Polynesia',
    tagline: 'Plan the future of a volcanic island with its communities, lagoon and reef.',
    intro:
      "A heart-shaped volcanic island with jagged peaks, two deep bays (Cook's Bay and ʻŌpūnohu Bay) and a lagoon ringed by coral reef. Communities have lived here for centuries and their land and voices come first. In this fictional scenario you lead a new island development authority: grow livelihoods, housing and tourism while protecting the reef and respecting land rights.",
    difficulty: ['Flat land only in a thin coastal strip', 'Freshwater depends on rain and the volcanic aquifer', 'Cyclones in the wet season', 'The reef and lagoon are fragile', 'Building near communities needs consultation'],
    difficultyLevel: 4,
    ethics: "Mo'orea is home to living communities with customary land. Nationforge marks land near existing settlements as community land: building there needs consultation and consent, and you cannot evict anyone. The scenario is fictional and does not represent real development plans.",
    climate: {
      temp: M(27, 27, 27, 27, 26, 25, 24.5, 24.5, 25, 25.5, 26, 26.5),
      rain: M(0.55, 0.55, 0.5, 0.42, 0.35, 0.3, 0.28, 0.25, 0.28, 0.35, 0.45, 0.55),
      wind: M(5, 5, 5, 5.5, 6, 6, 6.5, 6.5, 6.5, 6, 5.5, 5),
      storm: M(0.012, 0.012, 0.01, 0.005, 0, 0, 0, 0, 0, 0, 0.004, 0.01),
      fog: M(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0),
      sun: M(0.55, 0.55, 0.58, 0.6, 0.62, 0.65, 0.66, 0.68, 0.66, 0.62, 0.58, 0.55),
      windDir: [0.05, 0.15, 0.35, 0.25, 0.07, 0.04, 0.04, 0.05],
    },
    tourismSeason: M(1, 0.95, 1, 1, 1.05, 1.15, 1.25, 1.3, 1.1, 1, 0.95, 1.05),
    tourismBase: 14000,
    touristSpend: 1350,
    style: 'tropical',
    vegetation: 'tropical',
    startPop: 3200,
    startFunds: 110_000_000,
    startDebt: 30_000_000,
    baseWage: 2700,
    remoteness: 1.4,
    groundwater: 0.6,
    ferryCapacity: 3500,
    envWeight: 1.6,
    marineName: 'Reef health',
    disasters: [
      { kind: 'cyclone', p: 0.012, season: M(2.2, 2.4, 2, 0.8, 0, 0, 0, 0, 0, 0.2, 1, 1.8) },
      { kind: 'bleaching', p: 0.03, season: M(1.6, 1.8, 2, 1.4, 0.4, 0, 0, 0, 0, 0.2, 0.6, 1.2) },
      { kind: 'landslide', p: 0.015, season: M(1.6, 1.6, 1.3, 1, 0.6, 0.4, 0.4, 0.3, 0.4, 0.7, 1.1, 1.5) },
      { kind: 'drought', p: 0.012, season: M(0, 0, 0, 0.5, 1, 1.6, 2, 2.2, 1.6, 0.8, 0.2, 0) },
    ],
    regionCount: 5,
    regionNames: ['Afareaitu', 'Haapiti', 'Papetoai', "Pao Pao (Cook's Bay)", 'Maharepa & Temae'],
    regionAnchors: [[443, 320], [213, 344], [206, 141], [363, 187], [470, 110]],
    landmark: { name: 'ʻŌpūnohu marae cultural centre', p: [262, 228], desc: 'A community-led cultural and archaeological centre near the restored marae of the ʻŌpūnohu valley.' },
    startBuildings: [
      { type: 'town_hall', p: [364, 184] },
      { type: 'small_harbour', p: [491.7, 231] },
      { type: 'diesel_generator', p: [480, 215] },
      { type: 'school', p: [430, 118] },
      { type: 'school', p: [205, 146] },
      { type: 'clinic', p: [440, 322] },
      { type: 'clinic', p: [360, 180] },
      { type: 'shop', p: [473, 224] },
      { type: 'shop', p: [370, 182] },
      { type: 'shop', p: [210, 140] },
      { type: 'shop', p: [125, 140] },
      { type: 'hotel', p: [120, 145] },
      { type: 'hotel', p: [505, 120] },
      { type: 'guesthouse', p: [215, 345] },
      { type: 'fruit_plantation', p: [300, 240] },
      { type: 'well', p: [300, 255] },
      { type: 'well', p: [420, 300] },
      { type: 'rain_tank', p: [200, 160] },
      { type: 'pearl_farm', p: [150, 112] },
      { type: 'fishing_fleet', p: [487, 233] },
    ],
    startFromOsmHousing: true,
    objectives: [
      { id: 'reef', text: 'Keep reef health above 80', kind: 'marine', target: 80 },
      { id: 'port', text: 'Choose and build a commercial or cruise port', kind: 'portTier', target: 2, reward: 4_000_000 },
      { id: 'tourists', text: 'Host 20,000 visitors in a month', kind: 'tourists', target: 20000, reward: 4_000_000 },
      { id: 'pop', text: 'Grow to 5,000 residents', kind: 'pop', target: 5000, reward: 4_000_000 },
      { id: 'unemp', text: 'Bring unemployment below 7%', kind: 'unemploymentBelow', target: 0.07 },
      { id: 'green', text: 'Generate 50% of power from renewables', kind: 'renewableShare', target: 0.5 },
    ],
    foreignNames: ['Tahiti (beyond the map)'],
  },
];

export const SCENARIO_MAP: Record<string, Scenario> = Object.fromEntries(SCENARIOS.map((s) => [s.id, s]));
