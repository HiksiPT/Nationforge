// Daily weather from each island's climate profile, with day-to-day persistence. Deterministic via the game RNG.

import type { Climate } from '../data/scenarios';
import type { Rng } from './rng';
import type { WeatherDay } from './types';

export function initialWeather(c: Climate, month: number): WeatherDay {
  return { temp: c.temp[month], rain: 0, wind: c.wind[month], windDir: prevailingDir(c), cloud: 1 - c.sun[month], fog: 0, storm: false, kind: 'cloudy' };
}

export function prevailingDir(c: Climate): number {
  let best = 0;
  for (let i = 1; i < 8; i++) if (c.windDir[i] > c.windDir[best]) best = i;
  return (best * Math.PI) / 4;
}

export function nextWeather(c: Climate, month: number, prev: WeatherDay, rng: Rng, droughtFactor = 1): WeatherDay {
  const wasWet = prev.rain > 0.5;
  let pWet = c.rain[month] * droughtFactor;
  pWet = wasWet ? Math.min(0.95, pWet * 1.35) : pWet * 0.8;
  const storm = rng.chance(c.storm[month] * (wasWet ? 1.4 : 0.8));
  const wet = storm || rng.chance(pWet);
  const windMean = c.wind[month];
  let wind = prev.wind * 0.55 + (windMean + rng.normal() * windMean * 0.35) * 0.45;
  if (storm) wind = Math.max(wind, 19 + rng.next() * 9);
  wind = Math.max(0, wind);
  // wind direction: mostly the prevailing pattern, drifting from yesterday
  let windDir = prev.windDir;
  if (rng.chance(0.3)) {
    const pick = rng.weighted([0, 1, 2, 3, 4, 5, 6, 7], (i) => c.windDir[i]) ?? 0;
    windDir = (pick * Math.PI) / 4 + rng.range(-0.3, 0.3);
  }
  const rain = wet ? (storm ? 18 + rng.next() * 30 : 1 + rng.next() * rng.next() * 16) : 0;
  const cloud = Math.min(1, Math.max(0, wet ? 0.75 + rng.next() * 0.25 : (1 - c.sun[month]) * (0.4 + rng.next() * 0.9)));
  const fog = !storm && wind < 6 && rng.chance(c.fog[month] * (wasWet ? 1.6 : 1)) ? 0.5 + rng.next() * 0.5 : 0;
  const temp = c.temp[month] + rng.normal() * 2 - (wet ? 1 : 0) + (cloud < 0.3 ? 1 : 0);
  const kind: WeatherDay['kind'] = storm ? 'storm' : fog > 0 ? 'fog' : wet ? 'rain' : cloud > 0.55 ? 'cloudy' : 'clear';
  return { temp, rain, wind, windDir, cloud, fog, storm, kind };
}

/** Share of a normal day's construction work that gets done in this weather. */
export function constructionFactor(w: WeatherDay): number {
  if (w.storm) return 0;
  let f = 1;
  if (w.rain > 10) f *= 0.4;
  else if (w.rain > 0.5) f *= 0.7;
  if (w.wind > 15) f *= 0.5;
  else if (w.wind > 11) f *= 0.8;
  if (w.fog > 0) f *= 0.9;
  return f;
}

/** Whether ports can work today, given their shelter (0..1). Returns the operable fraction of the day. */
export function portOperable(w: WeatherDay, shelter: number): number {
  const effWind = w.wind * (1.15 - shelter * 0.7);
  if (w.storm && shelter < 0.85) return 0;
  if (effWind > 15) return 0;
  if (effWind > 11) return 0.5;
  if (w.fog > 0.7) return 0.6;
  return 1;
}

export function weatherLabel(w: WeatherDay): string {
  switch (w.kind) {
    case 'storm':
      return 'Storm';
    case 'fog':
      return 'Fog';
    case 'rain':
      return w.rain > 10 ? 'Heavy rain' : 'Rain';
    case 'cloudy':
      return 'Cloudy';
    default:
      return 'Clear';
  }
}

export function weatherIcon(w: WeatherDay): string {
  return { storm: '⛈', fog: '\u{1F32B}', rain: '\u{1F327}', cloudy: '☁', clear: '☀' }[w.kind];
}
