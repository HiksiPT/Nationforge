// Data-driven catalogue: resources, buildings, port types and upgrades. All gameplay numbers live here.
// Money is in dollars, flows are per month, footprints are game metres, power in MW, water in m3/month.

export type ResId =
  | 'food' | 'fish' | 'seafood' | 'timber' | 'stone' | 'goods' | 'fuel'
  | 'whisky' | 'wool' | 'olive_oil' | 'wine' | 'pearls' | 'fruit';

export interface ResourceDef {
  id: ResId;
  name: string;
  unit: string;
  price: number; // world price per unit
  perCapita: number; // domestic consumption per resident per month
  tonnage: number; // tonnes of port capacity per unit
  color: string;
}

export const RESOURCES: Record<ResId, ResourceDef> = {
  food: { id: 'food', name: 'Food & farm produce', unit: 't', price: 900, perCapita: 0.045, tonnage: 1, color: '#9bc25b' },
  fish: { id: 'fish', name: 'Fresh fish', unit: 't', price: 3200, perCapita: 0.004, tonnage: 1, color: '#5ba3c2' },
  seafood: { id: 'seafood', name: 'Processed seafood', unit: 't', price: 11000, perCapita: 0.001, tonnage: 1, color: '#3f7fb8' },
  timber: { id: 'timber', name: 'Timber', unit: 't', price: 260, perCapita: 0.01, tonnage: 1, color: '#8a6a3f' },
  stone: { id: 'stone', name: 'Dimension stone', unit: 't', price: 120, perCapita: 0.02, tonnage: 1, color: '#b9b2a3' },
  goods: { id: 'goods', name: 'Manufactured goods', unit: 't', price: 6000, perCapita: 0.012, tonnage: 1, color: '#c28a5b' },
  fuel: { id: 'fuel', name: 'Fuel', unit: 't', price: 1100, perCapita: 0.03, tonnage: 1, color: '#6d6d6d' },
  whisky: { id: 'whisky', name: 'Island whisky', unit: 't', price: 42000, perCapita: 0, tonnage: 1.3, color: '#c9902b' },
  wool: { id: 'wool', name: 'Wool & textiles', unit: 't', price: 5200, perCapita: 0, tonnage: 1, color: '#e4dccb' },
  olive_oil: { id: 'olive_oil', name: 'Olive oil', unit: 't', price: 7800, perCapita: 0.0005, tonnage: 1.1, color: '#a4a83a' },
  wine: { id: 'wine', name: 'Wine', unit: 't', price: 9500, perCapita: 0.0008, tonnage: 1.3, color: '#8b2d4a' },
  pearls: { id: 'pearls', name: 'Cultured pearls', unit: 'kg', price: 1500, perCapita: 0, tonnage: 0.002, color: '#c4c4dc' },
  fruit: { id: 'fruit', name: 'Tropical fruit & juice', unit: 't', price: 1900, perCapita: 0.004, tonnage: 1, color: '#e3b23c' },
};

export type Category = 'port' | 'residential' | 'commercial' | 'industrial' | 'tourism' | 'public' | 'utility' | 'transport';

export type Form =
  | 'cottage' | 'houses' | 'terrace' | 'apartments' | 'tower' | 'ecovillage'
  | 'shop' | 'market' | 'office' | 'campus'
  | 'guesthouse' | 'hotel' | 'resort' | 'lodge' | 'dive' | 'castle' | 'visitor'
  | 'farm' | 'barn' | 'orchard' | 'boats' | 'plant' | 'aquafarm' | 'distillery' | 'sawmill' | 'quarry'
  | 'workshop' | 'factory' | 'datacentre' | 'warehouse'
  | 'civic' | 'school' | 'college' | 'clinic' | 'hospital' | 'station' | 'park' | 'lab'
  | 'diesel' | 'turbine' | 'solar' | 'hydro' | 'battery' | 'well' | 'reservoir' | 'desal' | 'tank' | 'wastewater'
  | 'recycling' | 'airstrip' | 'helipad' | 'mast' | 'depot'
  | 'harbour' | 'marina' | 'port' | 'cruise' | 'container' | 'deepwater';

export type ServiceKind = 'education' | 'health' | 'safety' | 'leisure' | 'admin' | 'transport';

export interface PortSpec {
  tier: number;
  minDepth: number; // real metres at the quay
  capacity: number; // tonnes per month
  cruise?: number; // cruise passengers per month capacity
  yachts?: number; // marina visitors per month
  fishing?: boolean;
}

export interface Suitability {
  flat?: number; // prefers gentle slopes
  coast?: number; // prefers being near the sea
  inland?: number; // prefers being away from the sea
  high?: number; // prefers elevation / exposure (wind, masts)
  low?: number; // prefers low ground
  forest?: number; // needs forest nearby (sawmill)
  services?: number; // prefers service coverage (housing)
  quiet?: number; // dislikes industry nearby
  port?: number; // prefers proximity to a port
  view?: number; // prefers sea views (tourism)
  wind?: number;
  sun?: number;
}

export interface BuildingDef {
  id: string;
  name: string;
  cat: Category;
  desc: string;
  cost: number;
  maint: number; // fixed monthly maintenance (wages are paid separately)
  days: number; // construction days in good weather
  size: [number, number];
  h: number;
  form: Form;
  jobs?: number;
  housing?: number;
  beds?: number;
  power?: number;
  water?: number;
  out?: Partial<Record<ResId, number>>;
  inp?: Partial<Record<ResId, number>>;
  service?: { kind: ServiceKind; radius: number; cap: number };
  appeal?: number; // tourism appeal points
  pollution?: number;
  landImpact?: number; // one-off environment impact when built
  research?: number; // research points per month
  servicesExport?: number; // $ per month of exported services at full staffing
  commerce?: number; // residents served by shops
  wageMult?: number;
  needs?: string; // research id
  zone?: 'R' | 'C' | 'I';
  density?: 1 | 2 | 3;
  port?: PortSpec;
  unique?: boolean;
  only?: string[]; // scenario ids where available
  maxSlope: number;
  site?: 'land' | 'coast' | 'sea' | 'port-near';
  nearPort?: number;
  minElev?: number;
  suit: Suitability;
  socialRent?: boolean;
  access?: number; // reduces remoteness (airstrip, helipad)
  storage?: number; // port capacity bonus fraction (warehouse)
  powerKind?: 'diesel' | 'wind' | 'solar' | 'hydro' | 'wave' | 'battery';
  waterKind?: 'well' | 'reservoir' | 'desal' | 'rain';
  treats?: number; // wastewater population capacity
  recycles?: number; // pollution reduction
}

const B = (d: BuildingDef) => d;

export const BUILDINGS: BuildingDef[] = [
  // ---------------------------------------------------------------- ports (placed on the coast)
  B({ id: 'small_harbour', name: 'Small harbour', cat: 'port', form: 'harbour', desc: 'Stone jetty and slipway for ferries, fishing boats and small freighters. Cheap, needs only shallow water.', cost: 2_400_000, maint: 9_000, days: 120, size: [40, 46], h: 6, jobs: 8, maxSlope: 20, site: 'coast', port: { tier: 1, minDepth: 2.5, capacity: 1_800, fishing: true }, suit: { coast: 1 } }),
  B({ id: 'marina', name: 'Marina', cat: 'port', form: 'marina', desc: 'Pontoons and berths for visiting yachts. Brings high-spending sailing tourists.', cost: 4_800_000, maint: 14_000, days: 150, size: [70, 60], h: 5, jobs: 14, maxSlope: 18, site: 'coast', appeal: 4, port: { tier: 1, minDepth: 3, capacity: 300, yachts: 900 }, suit: { coast: 1, view: 0.5 } }),
  B({ id: 'commercial_port', name: 'Commercial port', cat: 'port', form: 'port', desc: 'General cargo quay with cranes and a roll-on/roll-off ramp. The backbone of island trade.', cost: 15_000_000, maint: 45_000, days: 300, size: [120, 90], h: 18, jobs: 60, maxSlope: 15, site: 'coast', pollution: 2, landImpact: 3, port: { tier: 2, minDepth: 7, capacity: 16_000, fishing: true }, suit: { coast: 1, flat: 1 } }),
  B({ id: 'cruise_terminal', name: 'Cruise terminal', cat: 'port', form: 'cruise', desc: 'Deep berth and terminal for cruise ships. Huge visitor numbers, heavy pressure on the environment.', cost: 24_000_000, maint: 60_000, days: 360, size: [140, 70], h: 16, jobs: 70, maxSlope: 15, site: 'coast', pollution: 3, landImpact: 4, appeal: 2, port: { tier: 2, minDepth: 9, capacity: 1_200, cruise: 12_000 }, suit: { coast: 1, flat: 0.5 } }),
  B({ id: 'container_port', name: 'Container port', cat: 'port', form: 'container', desc: 'Gantry cranes and a container yard. Turns the island into a trade hub.', cost: 62_000_000, maint: 160_000, days: 540, size: [220, 140], h: 40, jobs: 220, maxSlope: 10, site: 'coast', pollution: 6, landImpact: 8, needs: 'logistics', port: { tier: 3, minDepth: 12, capacity: 95_000 }, suit: { coast: 1, flat: 2 } }),
  B({ id: 'deepwater_port', name: 'Deep-water port', cat: 'port', form: 'deepwater', desc: 'Ultra-deep berth for bulk carriers and the largest ships, with an oil and bulk terminal.', cost: 96_000_000, maint: 230_000, days: 720, size: [260, 150], h: 45, jobs: 300, maxSlope: 10, site: 'coast', pollution: 9, landImpact: 10, needs: 'deep_water', port: { tier: 4, minDepth: 15, capacity: 210_000 }, suit: { coast: 1, flat: 2 } }),
  B({ id: 'warehouse', name: 'Port warehouse', cat: 'port', form: 'warehouse', desc: 'Covered storage beside a port: +20% throughput for the nearest port.', cost: 1_600_000, maint: 5_000, days: 90, size: [50, 28], h: 10, jobs: 10, maxSlope: 7, site: 'port-near', nearPort: 350, storage: 0.2, suit: { flat: 1, port: 2 } }),

  // ---------------------------------------------------------------- residential
  B({ id: 'cottage', name: 'Cottages', cat: 'residential', form: 'cottage', desc: 'A pair of small cottages. Cheap homes that suit rough ground.', cost: 360_000, maint: 400, days: 60, size: [16, 12], h: 6, housing: 6, power: -0.006, water: -24, maxSlope: 16, zone: 'R', density: 1, suit: { services: 0.5, quiet: 1, view: 0.5 } }),
  B({ id: 'houses', name: 'Family houses', cat: 'residential', form: 'houses', desc: 'A small cluster of detached family houses.', cost: 1_100_000, maint: 1_200, days: 90, size: [28, 24], h: 8, housing: 16, power: -0.018, water: -64, maxSlope: 12, zone: 'R', density: 1, suit: { services: 1, quiet: 1, flat: 0.5 } }),
  B({ id: 'terrace', name: 'Terraced row', cat: 'residential', form: 'terrace', desc: 'A row of townhouses. Efficient use of scarce flat land.', cost: 2_000_000, maint: 2_000, days: 120, size: [40, 14], h: 10, housing: 34, power: -0.04, water: -136, maxSlope: 10, zone: 'R', density: 2, suit: { services: 1.5, flat: 1 } }),
  B({ id: 'apartments', name: 'Apartment block', cat: 'residential', form: 'apartments', desc: 'Five-storey apartments. Dense housing for a growing town.', cost: 5_600_000, maint: 6_000, days: 210, size: [32, 22], h: 18, housing: 96, power: -0.11, water: -380, maxSlope: 8, zone: 'R', density: 3, suit: { services: 2, flat: 1 } }),
  B({ id: 'tower', name: 'Residential tower', cat: 'residential', form: 'tower', desc: 'A high-rise tower. Enormous capacity on a tiny footprint.', cost: 21_000_000, maint: 22_000, days: 420, size: [30, 30], h: 72, housing: 340, power: -0.42, water: -1350, maxSlope: 7, needs: 'highrise', density: 3, suit: { services: 2, flat: 1, view: 0.5 } }),
  B({ id: 'social_housing', name: 'Social housing', cat: 'residential', form: 'apartments', desc: 'Publicly owned apartments let at controlled rents. Lowers rents and inequality; the state pays upkeep.', cost: 5_000_000, maint: 14_000, days: 200, size: [32, 22], h: 15, housing: 84, power: -0.1, water: -330, maxSlope: 8, socialRent: true, suit: { services: 2, flat: 1 } }),
  B({ id: 'ecovillage', name: 'Eco-village', cat: 'residential', form: 'ecovillage', desc: 'Low-impact timber homes with their own solar and rainwater.', cost: 3_200_000, maint: 2_500, days: 160, size: [44, 36], h: 7, housing: 44, power: -0.01, water: -60, maxSlope: 14, needs: 'green_building', suit: { quiet: 2, view: 1 } }),

  // ---------------------------------------------------------------- commercial
  B({ id: 'shop', name: 'Shops & café', cat: 'commercial', form: 'shop', desc: 'Local shops. Residents need them: each serves about 250 people.', cost: 520_000, maint: 900, days: 70, size: [18, 14], h: 7, jobs: 8, commerce: 250, power: -0.02, water: -40, maxSlope: 10, zone: 'C', density: 1, suit: { services: 1, flat: 1 } }),
  B({ id: 'market', name: 'Market hall', cat: 'commercial', form: 'market', desc: 'Covered market and grocers serving about 900 people; island produce sells here.', cost: 1_900_000, maint: 3_000, days: 120, size: [34, 22], h: 9, jobs: 22, commerce: 900, power: -0.05, water: -90, maxSlope: 8, zone: 'C', density: 2, suit: { services: 1, flat: 1.5 } }),
  B({ id: 'offices', name: 'Office building', cat: 'commercial', form: 'office', desc: 'Offices for finance, shipping agents and professional services that export to the world.', cost: 6_400_000, maint: 7_000, days: 220, size: [30, 24], h: 24, jobs: 85, commerce: 200, servicesExport: 520_000, power: -0.25, water: -170, maxSlope: 8, zone: 'C', density: 3, wageMult: 1.3, suit: { services: 2, flat: 1 } }),
  B({ id: 'tech_campus', name: 'Tech campus', cat: 'commercial', form: 'campus', desc: 'Software and design studios. High wages, exports services, needs educated workers.', cost: 26_000_000, maint: 30_000, days: 380, size: [70, 50], h: 20, jobs: 220, servicesExport: 2_000_000, power: -0.9, water: -500, maxSlope: 8, needs: 'tech', wageMult: 1.7, suit: { services: 2, quiet: 1, view: 0.5 } }),
  B({ id: 'data_centre', name: 'Data centre', cat: 'commercial', form: 'datacentre', desc: 'Hosting hall that sells computing abroad. Very power hungry; cool climates cut cooling costs.', cost: 18_000_000, maint: 25_000, days: 300, size: [60, 40], h: 12, jobs: 26, servicesExport: 1_300_000, power: -6, water: -900, maxSlope: 6, needs: 'digital', wageMult: 1.5, suit: { flat: 2, inland: 0.5 } }),

  // ---------------------------------------------------------------- tourism
  B({ id: 'guesthouse', name: 'Guesthouse', cat: 'tourism', form: 'guesthouse', desc: 'Family-run bed & breakfast with 16 beds.', cost: 750_000, maint: 1_500, days: 80, size: [18, 14], h: 8, jobs: 5, beds: 16, power: -0.02, water: -80, maxSlope: 14, suit: { view: 1.5, coast: 1, quiet: 1 } }),
  B({ id: 'hotel', name: 'Hotel', cat: 'tourism', form: 'hotel', desc: 'A 120-bed hotel with restaurant.', cost: 10_500_000, maint: 18_000, days: 260, size: [44, 26], h: 20, jobs: 46, beds: 120, power: -0.3, water: -900, pollution: 0.5, maxSlope: 9, suit: { view: 2, coast: 1.5, services: 0.5 } }),
  B({ id: 'resort', name: 'Beach resort', cat: 'tourism', form: 'resort', desc: 'Large resort with pools and villas. Lucrative, land hungry, hard on the coast.', cost: 30_000_000, maint: 45_000, days: 420, size: [110, 70], h: 14, jobs: 150, beds: 320, appeal: 3, power: -0.8, water: -3000, pollution: 2, landImpact: 6, maxSlope: 8, suit: { coast: 2, view: 2, flat: 1 } }),
  B({ id: 'ecolodge', name: 'Eco-lodge', cat: 'tourism', form: 'lodge', desc: 'Small low-impact lodge in nature. Raises the island’s appeal to nature tourists.', cost: 3_400_000, maint: 5_000, days: 160, size: [36, 30], h: 7, jobs: 18, beds: 40, appeal: 3, power: -0.03, water: -150, maxSlope: 18, suit: { view: 1, quiet: 2 } }),
  B({ id: 'dive_centre', name: 'Dive & kayak centre', cat: 'tourism', form: 'dive', desc: 'Guided dives, snorkelling and kayaks. Its appeal depends on healthy marine life.', cost: 900_000, maint: 2_500, days: 70, size: [16, 12], h: 6, jobs: 7, appeal: 4, power: -0.01, water: -30, maxSlope: 14, suit: { coast: 3 } }),
  B({ id: 'visitor_centre', name: 'Visitor & heritage centre', cat: 'tourism', form: 'visitor', desc: 'Museum, trails and guided walks. Appeal grows with environmental quality.', cost: 2_200_000, maint: 6_000, days: 140, size: [28, 20], h: 8, jobs: 12, appeal: 5, power: -0.03, water: -60, maxSlope: 12, suit: { view: 1, quiet: 1 } }),
  B({ id: 'heritage_restoration', name: 'Heritage restoration', cat: 'tourism', form: 'castle', desc: 'Restore the island’s historic landmark as a venue and attraction. One per island, place it at the landmark.', cost: 8_500_000, maint: 12_000, days: 330, size: [34, 26], h: 22, jobs: 24, beds: 24, appeal: 12, power: -0.05, water: -120, maxSlope: 16, unique: true, suit: { view: 1 } }),

  // ---------------------------------------------------------------- industry and agriculture
  B({ id: 'farm', name: 'Mixed farm', cat: 'industrial', form: 'farm', desc: 'Fields, greenhouses and a farmyard. Needs flat land.', cost: 900_000, maint: 2_500, days: 90, size: [90, 70], h: 7, jobs: 7, out: { food: 34 }, power: -0.02, water: -1500, maxSlope: 7, landImpact: 1, suit: { flat: 2, low: 1, inland: 0.5 } }),
  B({ id: 'sheep_farm', name: 'Hill sheep farm', cat: 'industrial', form: 'barn', desc: 'Grazing on rough hill ground. Produces wool and lamb on land too steep for crops.', cost: 650_000, maint: 1_800, days: 70, size: [70, 60], h: 6, jobs: 4, out: { wool: 2.2, food: 8 }, power: -0.005, water: -300, maxSlope: 22, only: ['shuna', 'guafo'], suit: { high: 0.5 } }),
  B({ id: 'olive_grove', name: 'Olive grove & press', cat: 'industrial', form: 'orchard', desc: 'Terraced olives with a small press. Thrives on dry rocky slopes.', cost: 1_200_000, maint: 2_500, days: 120, size: [80, 60], h: 5, jobs: 9, out: { olive_oil: 4.2 }, power: -0.02, water: -400, maxSlope: 18, only: ['makri', 'lastovo'], suit: { sun: 1 } }),
  B({ id: 'vineyard', name: 'Vineyard & winery', cat: 'industrial', form: 'orchard', desc: 'Terraced vines and a cellar. Island wine sells well abroad.', cost: 1_700_000, maint: 3_200, days: 150, size: [80, 60], h: 6, jobs: 12, out: { wine: 4.5 }, power: -0.05, water: -600, maxSlope: 16, only: ['makri', 'lastovo'], suit: { sun: 1, flat: 0.5 } }),
  B({ id: 'fruit_plantation', name: 'Fruit plantation', cat: 'industrial', form: 'orchard', desc: 'Pineapple and vanilla fields with a juice plant.', cost: 1_300_000, maint: 2_500, days: 110, size: [90, 70], h: 5, jobs: 14, out: { fruit: 26 }, power: -0.04, water: -1200, maxSlope: 10, only: ['moorea'], suit: { flat: 1.5, inland: 0.5 } }),
  B({ id: 'fishing_fleet', name: 'Fishing co-operative', cat: 'industrial', form: 'boats', desc: 'Boats, ice house and nets. Must be near a harbour or port; storms keep the boats in.', cost: 1_400_000, maint: 4_000, days: 80, size: [26, 18], h: 6, jobs: 18, out: { fish: 24 }, inp: { fuel: 3 }, power: -0.04, water: -60, maxSlope: 12, site: 'port-near', nearPort: 400, suit: { port: 2, coast: 1 } }),
  B({ id: 'fish_processing', name: 'Seafood processing', cat: 'industrial', form: 'plant', desc: 'Turns fresh fish into high-value packaged seafood for export.', cost: 4_200_000, maint: 7_000, days: 160, size: [40, 26], h: 10, jobs: 26, inp: { fish: 18 }, out: { seafood: 16 }, power: -0.45, water: -900, pollution: 1.5, maxSlope: 7, suit: { port: 1.5, flat: 1 } }),
  B({ id: 'aquaculture', name: 'Aquaculture farm', cat: 'industrial', form: 'aquafarm', desc: 'Mussel lines or fish pens in sheltered water. Profitable but pollutes nearby water.', cost: 2_300_000, maint: 5_000, days: 100, size: [80, 50], h: 2, jobs: 14, out: { seafood: 6 }, power: -0.03, water: 0, pollution: 2.5, maxSlope: 90, site: 'sea', suit: { coast: 2 } }),
  B({ id: 'pearl_farm', name: 'Black pearl farm', cat: 'industrial', form: 'aquafarm', desc: 'Lagoon pearl oyster lines. Valuable, but only in clean water.', cost: 1_900_000, maint: 4_500, days: 120, size: [70, 50], h: 2, jobs: 16, out: { pearls: 60 }, pollution: 0.6, maxSlope: 90, site: 'sea', only: ['moorea'], suit: { coast: 2 } }),
  B({ id: 'distillery', name: 'Whisky distillery', cat: 'industrial', form: 'distillery', desc: 'Malt barley into single malt. A famous island export and a visitor attraction.', cost: 6_500_000, maint: 9_000, days: 260, size: [44, 26], h: 14, jobs: 20, inp: { food: 7 }, out: { whisky: 3.2 }, appeal: 2, power: -0.15, water: -1400, pollution: 0.8, maxSlope: 8, only: ['shuna'], suit: { coast: 1, flat: 1 } }),
  B({ id: 'sawmill', name: 'Sawmill', cat: 'industrial', form: 'sawmill', desc: 'Logs the surrounding forest. Real income, real damage to the forest.', cost: 2_000_000, maint: 3_500, days: 100, size: [46, 30], h: 9, jobs: 16, out: { timber: 220 }, inp: { fuel: 4 }, power: -0.2, water: -100, pollution: 1.5, landImpact: 4, maxSlope: 10, suit: { forest: 3, flat: 1 } }),
  B({ id: 'quarry', name: 'Stone quarry', cat: 'industrial', form: 'quarry', desc: 'Cuts limestone and building stone. Noisy and scars the hillside.', cost: 1_800_000, maint: 3_000, days: 90, size: [70, 60], h: 6, jobs: 13, out: { stone: 900 }, inp: { fuel: 6 }, power: -0.15, water: -200, pollution: 2, landImpact: 5, maxSlope: 30, suit: { high: 1 } }),
  B({ id: 'workshop', name: 'Workshops', cat: 'industrial', form: 'workshop', desc: 'Small manufacturers and repair yards.', cost: 1_500_000, maint: 2_000, days: 100, size: [32, 22], h: 8, jobs: 20, out: { goods: 16 }, inp: { timber: 8 }, power: -0.15, water: -120, pollution: 0.8, maxSlope: 8, zone: 'I', density: 1, suit: { flat: 1.5, port: 0.5 } }),
  B({ id: 'factory', name: 'Light factory', cat: 'industrial', form: 'factory', desc: 'Assembly plant producing goods for export. Needs power, fuel and a port.', cost: 9_000_000, maint: 9_000, days: 240, size: [60, 40], h: 14, jobs: 90, out: { goods: 65 }, inp: { fuel: 14 }, power: -1.2, water: -800, pollution: 4, maxSlope: 6, zone: 'I', density: 2, suit: { flat: 2, port: 1.5 } }),
  B({ id: 'boatyard', name: 'Boatyard', cat: 'industrial', form: 'warehouse', desc: 'Builds and repairs boats. Coastal site, near a harbour.', cost: 3_000_000, maint: 4_000, days: 150, size: [44, 30], h: 14, jobs: 32, out: { goods: 24 }, inp: { timber: 30 }, power: -0.2, water: -100, pollution: 1, maxSlope: 8, site: 'port-near', nearPort: 600, suit: { coast: 2, port: 1 } }),

  // ---------------------------------------------------------------- public services
  B({ id: 'town_hall', name: 'Town hall', cat: 'public', form: 'civic', desc: 'Seat of government. Required to run services; residents expect one.', cost: 2_400_000, maint: 4_000, days: 150, size: [30, 22], h: 14, jobs: 8, service: { kind: 'admin', radius: 99999, cap: 50000 }, power: -0.05, water: -60, maxSlope: 10, unique: true, suit: { flat: 1, services: 1 } }),
  B({ id: 'school', name: 'School', cat: 'public', form: 'school', desc: 'Primary and secondary school for about 2,000 residents. Generates some research.', cost: 3_800_000, maint: 7_000, days: 180, size: [44, 30], h: 9, jobs: 32, research: 1.5, service: { kind: 'education', radius: 900, cap: 2000 }, power: -0.08, water: -200, maxSlope: 8, suit: { flat: 1, services: 0.5, quiet: 1 } }),
  B({ id: 'college', name: 'College', cat: 'public', form: 'college', desc: 'Further education. Raises productivity and research.', cost: 12_000_000, maint: 20_000, days: 300, size: [60, 40], h: 14, jobs: 70, research: 6, service: { kind: 'education', radius: 3000, cap: 9000 }, power: -0.3, water: -500, maxSlope: 8, suit: { flat: 1, quiet: 1 } }),
  B({ id: 'research_institute', name: 'Research institute', cat: 'public', form: 'lab', desc: 'Marine, climate and engineering research. Big research output.', cost: 16_000_000, maint: 30_000, days: 320, size: [50, 36], h: 16, jobs: 80, research: 14, wageMult: 1.4, power: -0.6, water: -300, maxSlope: 8, needs: 'education2', suit: { quiet: 1, coast: 0.5 } }),
  B({ id: 'clinic', name: 'Health clinic', cat: 'public', form: 'clinic', desc: 'GP clinic and pharmacy for about 1,500 residents.', cost: 1_400_000, maint: 4_000, days: 110, size: [22, 16], h: 7, jobs: 14, service: { kind: 'health', radius: 1000, cap: 1500 }, power: -0.04, water: -100, maxSlope: 10, suit: { services: 1, flat: 1 } }),
  B({ id: 'hospital', name: 'Hospital', cat: 'public', form: 'hospital', desc: 'District hospital for about 12,000 residents, with a helipad.', cost: 26_000_000, maint: 60_000, days: 420, size: [60, 44], h: 22, jobs: 180, service: { kind: 'health', radius: 6000, cap: 12000 }, power: -0.8, water: -1500, maxSlope: 7, suit: { flat: 1.5, services: 1 } }),
  B({ id: 'police', name: 'Police station', cat: 'public', form: 'station', desc: 'Community policing and coastguard liaison.', cost: 1_500_000, maint: 3_500, days: 110, size: [22, 16], h: 8, jobs: 16, service: { kind: 'safety', radius: 1400, cap: 4000 }, power: -0.03, water: -40, maxSlope: 10, suit: { services: 1 } }),
  B({ id: 'fire_station', name: 'Fire & rescue', cat: 'public', form: 'station', desc: 'Firefighters and rescue boat. Cuts wildfire and storm damage nearby.', cost: 1_900_000, maint: 4_000, days: 120, size: [26, 18], h: 9, jobs: 16, service: { kind: 'safety', radius: 1800, cap: 5000 }, power: -0.03, water: -60, maxSlope: 10, suit: { services: 1 } }),
  B({ id: 'park', name: 'Park & playground', cat: 'public', form: 'park', desc: 'Green space. Raises approval and land values nearby.', cost: 300_000, maint: 900, days: 40, size: [36, 30], h: 2, jobs: 2, service: { kind: 'leisure', radius: 500, cap: 1500 }, maxSlope: 14, suit: { services: 1 } }),
  B({ id: 'community_centre', name: 'Community centre', cat: 'public', form: 'civic', desc: 'Halls, library and sports. Important for approval in small communities.', cost: 1_600_000, maint: 3_000, days: 120, size: [26, 20], h: 9, jobs: 9, service: { kind: 'leisure', radius: 1500, cap: 3000 }, power: -0.03, water: -60, maxSlope: 10, suit: { services: 1 } }),

  // ---------------------------------------------------------------- utilities
  B({ id: 'diesel_generator', name: 'Diesel power station', cat: 'utility', form: 'diesel', desc: '4 MW of reliable power that burns imported fuel (about 630 t a month at full load).', cost: 3_200_000, maint: 8_000, days: 90, size: [30, 20], h: 10, jobs: 6, power: 4, powerKind: 'diesel', inp: { fuel: 630 }, pollution: 4, maxSlope: 8, suit: { flat: 1, port: 1 } }),
  B({ id: 'wind_turbine', name: 'Wind turbine', cat: 'utility', form: 'turbine', desc: '2.5 MW turbine. Output follows the daily wind; best on exposed high ground.', cost: 4_300_000, maint: 6_000, days: 140, size: [16, 16], h: 90, jobs: 1, power: 2.5, powerKind: 'wind', maxSlope: 16, suit: { high: 2, wind: 2 } }),
  B({ id: 'solar_farm', name: 'Solar farm', cat: 'utility', form: 'solar', desc: '3 MW of panels. Output follows sunshine and season; needs flat open ground.', cost: 3_600_000, maint: 3_000, days: 110, size: [80, 60], h: 3, jobs: 1, power: 3, powerKind: 'solar', landImpact: 1, maxSlope: 8, suit: { flat: 2, sun: 2 } }),
  B({ id: 'small_hydro', name: 'Small hydro scheme', cat: 'utility', form: 'hydro', desc: 'Run-of-river turbine fed from the hills. Output follows rainfall.', cost: 6_000_000, maint: 5_000, days: 200, size: [24, 18], h: 8, jobs: 2, power: 1.6, powerKind: 'hydro', minElev: 30, landImpact: 2, maxSlope: 30, suit: { high: 1 } }),
  B({ id: 'battery', name: 'Grid battery', cat: 'utility', form: 'battery', desc: 'Stores renewable power for still, dark days (+30% firm renewable output, up to 5 MW).', cost: 4_800_000, maint: 2_500, days: 90, size: [24, 16], h: 4, jobs: 1, power: 0, powerKind: 'battery', maxSlope: 8, needs: 'smart_grid', suit: { flat: 1 } }),
  B({ id: 'wave_energy', name: 'Wave energy station', cat: 'utility', form: 'plant', desc: 'Oscillating water column on an exposed shore: 2 MW, steadier than wind.', cost: 9_000_000, maint: 8_000, days: 240, size: [30, 20], h: 8, jobs: 3, power: 2, powerKind: 'wave', maxSlope: 30, site: 'coast', needs: 'tidal', suit: { coast: 2 } }),
  B({ id: 'well', name: 'Borehole', cat: 'utility', form: 'well', desc: 'Groundwater pump (6,000 m3 a month), limited by the local aquifer.', cost: 350_000, maint: 900, days: 40, size: [10, 10], h: 4, jobs: 1, water: 6000, waterKind: 'well', power: -0.02, maxSlope: 14, suit: { low: 1, inland: 1 } }),
  B({ id: 'rain_tank', name: 'Rainwater cistern', cat: 'utility', form: 'tank', desc: 'Roof and slope catchment into a cistern. Output follows rainfall.', cost: 260_000, maint: 400, days: 30, size: [12, 12], h: 5, jobs: 0, water: 3500, waterKind: 'rain', maxSlope: 16, suit: {} }),
  B({ id: 'reservoir', name: 'Reservoir', cat: 'utility', form: 'reservoir', desc: 'Dam a valley to store winter rain: 24,000 m3 a month in an average year. Floods land.', cost: 6_500_000, maint: 4_000, days: 260, size: [90, 70], h: 6, jobs: 3, water: 24000, waterKind: 'reservoir', landImpact: 5, maxSlope: 18, minElev: 10, suit: { high: 0.5 } }),
  B({ id: 'desalination', name: 'Desalination plant', cat: 'utility', form: 'desal', desc: 'Reverse-osmosis plant on the shore: 30,000 m3 a month of drought-proof water, uses 1.5 MW.', cost: 11_000_000, maint: 14_000, days: 240, size: [40, 28], h: 9, jobs: 9, water: 30000, waterKind: 'desal', power: -1.5, pollution: 1, maxSlope: 8, site: 'coast', suit: { coast: 2, flat: 1 } }),
  B({ id: 'wastewater', name: 'Wastewater plant', cat: 'utility', form: 'wastewater', desc: 'Treats sewage for 5,000 people. Without it the sea around the island suffers.', cost: 4_400_000, maint: 7_000, days: 180, size: [40, 30], h: 5, jobs: 6, treats: 5000, power: -0.3, maxSlope: 8, suit: { low: 1, flat: 1 } }),
  B({ id: 'recycling', name: 'Recycling centre', cat: 'utility', form: 'recycling', desc: 'Sorts and ships waste. Cuts pollution across the island.', cost: 2_200_000, maint: 5_000, days: 120, size: [36, 24], h: 8, jobs: 14, recycles: 4, power: -0.1, maxSlope: 8, suit: { flat: 1, inland: 1 } }),

  // ---------------------------------------------------------------- transport & communications
  B({ id: 'helipad', name: 'Helipad', cat: 'transport', form: 'helipad', desc: 'Medical evacuation and charter flights. Reduces remoteness a little.', cost: 900_000, maint: 2_500, days: 60, size: [24, 24], h: 1, jobs: 3, access: 0.06, maxSlope: 5, suit: { flat: 1 } }),
  B({ id: 'airstrip', name: 'Airstrip', cat: 'transport', form: 'airstrip', desc: '700 m runway for island-hopper planes. Big boost to tourism and access; needs a long flat strip.', cost: 14_000_000, maint: 20_000, days: 300, size: [700, 50], h: 4, jobs: 22, access: 0.22, appeal: 2, pollution: 1, landImpact: 6, maxSlope: 4, suit: { flat: 3 } }),
  B({ id: 'telecom_mast', name: 'Telecom mast', cat: 'transport', form: 'mast', desc: 'Mobile and broadband coverage. Raises productivity (+3%) and approval.', cost: 700_000, maint: 1_500, days: 50, size: [10, 10], h: 45, jobs: 1, power: -0.01, maxSlope: 25, suit: { high: 2 } }),
  B({ id: 'bus_depot', name: 'Bus depot', cat: 'transport', form: 'depot', desc: 'Island bus routes. Lets residents reach jobs further away (+5% employment reach).', cost: 1_700_000, maint: 6_000, days: 100, size: [36, 24], h: 7, jobs: 14, service: { kind: 'transport', radius: 99999, cap: 8000 }, power: -0.05, maxSlope: 7, suit: { flat: 1 } }),
];

export const BUILDING_MAP: Record<string, BuildingDef> = Object.fromEntries(BUILDINGS.map((b) => [b.id, b]));

export const CATEGORY_INFO: Record<Category, { name: string; icon: string; color: string }> = {
  port: { name: 'Ports & maritime', icon: '⚓', color: '#4aa3df' },
  residential: { name: 'Housing', icon: '⌂', color: '#7bc96f' },
  commercial: { name: 'Commerce & services', icon: '\u{1F3EC}', color: '#5d8de0' },
  tourism: { name: 'Tourism & heritage', icon: '☀', color: '#e7a93c' },
  industrial: { name: 'Industry & farming', icon: '⚒', color: '#d1824a' },
  public: { name: 'Public services', icon: '⚕', color: '#b07ce0' },
  utility: { name: 'Power & water', icon: '⚡', color: '#e0d24a' },
  transport: { name: 'Transport & comms', icon: '✈', color: '#9aa5b1' },
};

// ---------------------------------------------------------------- port upgrades (built from a port's panel)

export interface PortUpgradeDef {
  id: string;
  name: string;
  desc: string;
  cost: number; // base cost; breakwater and dredging scale with the site
  days: number;
  repeatable?: number; // max count
  needs?: string;
  minTier?: number;
}

export const PORT_UPGRADES: PortUpgradeDef[] = [
  { id: 'breakwater', name: 'Breakwater', desc: 'Rock-armour arm that shelters the berth. +35% shelter, fewer weather closures.', cost: 3_500_000, days: 160, repeatable: 2 },
  { id: 'dredging', name: 'Dredging campaign', desc: 'Deepens the berth and approach by 3 m. Damages the seabed, especially reefs.', cost: 2_800_000, days: 90, repeatable: 4 },
  { id: 'quay', name: 'Quay extension', desc: 'Another berth: +35% throughput.', cost: 4_000_000, days: 140, repeatable: 3, minTier: 1 },
  { id: 'customs', name: 'Customs house', desc: 'Faster clearance: +15% trade efficiency, required above 20,000 t a month.', cost: 1_800_000, days: 100 },
  { id: 'road_link', name: 'Road link', desc: 'Builds a road from the port to the nearest road network.', cost: 0, days: 0 },
  { id: 'utility_link', name: 'Utility link', desc: 'Power cable and water main to the quay. Without it the port runs at half capacity.', cost: 900_000, days: 60 },
  { id: 'rail_link', name: 'Rail freight link', desc: 'A short freight railway to the industrial zone: +25% throughput, less road wear.', cost: 9_000_000, days: 220, needs: 'rail', minTier: 2 },
];

export const PORT_UPGRADE_MAP = Object.fromEntries(PORT_UPGRADES.map((u) => [u.id, u]));

// ---------------------------------------------------------------- roads

export interface RoadClass {
  id: 'track' | 'road' | 'avenue';
  name: string;
  costPerM: number;
  maxGrade: number; // rise over run
  width: number;
  daysPerKm: number;
  needs?: string;
}

export const ROAD_CLASSES: Record<RoadClass['id'], RoadClass> = {
  track: { id: 'track', name: 'Gravel track', costPerM: 260, maxGrade: 0.18, width: 4, daysPerKm: 20 },
  road: { id: 'road', name: 'Two-lane road', costPerM: 950, maxGrade: 0.12, width: 7, daysPerKm: 45 },
  avenue: { id: 'avenue', name: 'Avenue', costPerM: 2600, maxGrade: 0.08, width: 12, daysPerKm: 80, needs: 'urbanism' },
};

// ---------------------------------------------------------------- zones

export const ZONES = {
  R: { name: 'Residential zone', color: [90, 200, 110] as [number, number, number] },
  C: { name: 'Commercial zone', color: [80, 140, 230] as [number, number, number] },
  I: { name: 'Industrial zone', color: [230, 170, 70] as [number, number, number] },
};
export type ZoneId = keyof typeof ZONES;
export const ZONE_CODES: Record<ZoneId, number> = { R: 1, C: 2, I: 3 };
export const ZONE_FROM_CODE: Record<number, ZoneId> = { 1: 'R', 2: 'C', 3: 'I' };
export const ZONE_COST_PER_CELL = 1500;
