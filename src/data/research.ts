// Research tree. Effects are read by the simulation through hasTech()/techBonus().

export interface TechDef {
  id: string;
  name: string;
  tier: number;
  cost: number; // research points
  prereq: string[];
  desc: string;
  unlocks?: string[]; // building / upgrade / road ids
  bonus?: Partial<Record<TechBonus, number>>;
}

export type TechBonus =
  | 'construction' // construction speed
  | 'farm' // farm & orchard output
  | 'fish' // fishing & aquaculture output
  | 'renewable' // wind/solar/hydro/wave output
  | 'tourism' // tourism demand
  | 'port' // port throughput
  | 'productivity' // all wages/value added
  | 'pollution' // pollution reduction (fraction)
  | 'disaster' // disaster damage reduction (fraction)
  | 'reef' // reef/marine recovery
  | 'health' // service effectiveness
  | 'water'; // water efficiency

export const TECHS: TechDef[] = [
  { id: 'survey', name: 'Geological survey', tier: 1, cost: 30, prereq: [], desc: 'Map soils, aquifers and the seabed. +10% borehole output, cheaper earthworks.', bonus: { water: 0.1 } },
  { id: 'cooperatives', name: 'Farming co-operatives', tier: 1, cost: 40, prereq: [], desc: 'Shared machinery and marketing. +15% farm and orchard output.', bonus: { farm: 0.15 } },
  { id: 'harbour_eng', name: 'Harbour engineering', tier: 1, cost: 45, prereq: [], desc: 'Better quays and moorings. +10% port throughput, 20% faster port construction.', bonus: { port: 0.1 } },
  { id: 'renewables', name: 'Renewable integration', tier: 1, cost: 50, prereq: [], desc: '+15% wind, solar, hydro and wave output.', bonus: { renewable: 0.15 } },
  { id: 'tourism_mkt', name: 'Destination marketing', tier: 1, cost: 40, prereq: [], desc: '+12% tourism demand from every market.', bonus: { tourism: 0.12 } },
  { id: 'public_health', name: 'Public health', tier: 1, cost: 40, prereq: [], desc: 'Clinics and hospitals serve 20% more people.', bonus: { health: 0.2 } },
  { id: 'urbanism', name: 'Urban design', tier: 2, cost: 80, prereq: ['survey'], desc: 'Unlocks avenues and lets zones grow denser buildings sooner.', unlocks: ['avenue'] },
  { id: 'logistics', name: 'Container logistics', tier: 2, cost: 120, prereq: ['harbour_eng'], desc: 'Unlocks the container port. +10% port throughput.', unlocks: ['container_port'], bonus: { port: 0.1 } },
  { id: 'green_building', name: 'Green building', tier: 2, cost: 90, prereq: ['renewables'], desc: 'Unlocks eco-villages. -10% pollution from all buildings.', unlocks: ['ecovillage'], bonus: { pollution: 0.1 } },
  { id: 'highrise', name: 'High-rise construction', tier: 2, cost: 110, prereq: ['urbanism'], desc: 'Unlocks residential towers and high-rise architecture.', unlocks: ['tower'] },
  { id: 'aquaculture_sci', name: 'Marine aquaculture', tier: 2, cost: 90, prereq: ['cooperatives'], desc: '+20% fishing and aquaculture output, less pollution from fish farms.', bonus: { fish: 0.2 } },
  { id: 'education2', name: 'Higher education', tier: 2, cost: 100, prereq: ['public_health'], desc: 'Unlocks the research institute. +4% productivity.', unlocks: ['research_institute'], bonus: { productivity: 0.04 } },
  { id: 'smart_grid', name: 'Smart grid', tier: 2, cost: 110, prereq: ['renewables'], desc: 'Unlocks grid batteries. +10% renewable output.', unlocks: ['battery'], bonus: { renewable: 0.1 } },
  { id: 'deep_water', name: 'Deep-water engineering', tier: 3, cost: 220, prereq: ['logistics'], desc: 'Unlocks the deep-water port. Dredging costs 25% less.', unlocks: ['deepwater_port'] },
  { id: 'rail', name: 'Freight rail', tier: 3, cost: 160, prereq: ['logistics', 'urbanism'], desc: 'Unlocks rail freight links for ports.', unlocks: ['rail_link'] },
  { id: 'digital', name: 'Digital economy', tier: 3, cost: 180, prereq: ['education2'], desc: 'Unlocks data centres. +5% productivity.', unlocks: ['data_centre'], bonus: { productivity: 0.05 } },
  { id: 'storm_resilience', name: 'Storm resilience', tier: 3, cost: 150, prereq: ['harbour_eng', 'survey'], desc: 'Building codes and early warning: -40% disaster damage.', bonus: { disaster: 0.4 } },
  { id: 'reef_restoration', name: 'Reef & habitat restoration', tier: 3, cost: 150, prereq: ['aquaculture_sci'], desc: 'Coral gardening and seagrass replanting: marine health recovers twice as fast.', bonus: { reef: 1 } },
  { id: 'tech', name: 'Tech sector', tier: 4, cost: 260, prereq: ['digital'], desc: 'Unlocks the tech campus. +5% productivity.', unlocks: ['tech_campus'], bonus: { productivity: 0.05 } },
  { id: 'circular', name: 'Circular economy', tier: 4, cost: 240, prereq: ['green_building'], desc: '-25% pollution, -10% water use.', bonus: { pollution: 0.25, water: 0.1 } },
  { id: 'tidal', name: 'Wave & tidal power', tier: 4, cost: 230, prereq: ['smart_grid'], desc: 'Unlocks wave energy stations.', unlocks: ['wave_energy'] },
  { id: 'futurism', name: 'Future cities', tier: 5, cost: 400, prereq: ['tech', 'highrise'], desc: 'Unlocks the futuristic architecture style. +6% productivity, +8% tourism.', bonus: { productivity: 0.06, tourism: 0.08 } },
];

export const TECH_MAP: Record<string, TechDef> = Object.fromEntries(TECHS.map((t) => [t.id, t]));

/** Which tech unlocks a given building, upgrade or road class. */
export const UNLOCKED_BY: Record<string, string> = {};
for (const t of TECHS) for (const u of t.unlocks ?? []) UNLOCKED_BY[u] = t.id;
