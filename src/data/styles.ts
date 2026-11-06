// Architectural styles. The renderer builds a different mesh kit per style; the simulation only stores the id.

export type Style = 'tropical' | 'mediterranean' | 'european' | 'highrise' | 'futuristic' | 'rural' | 'industrial';

export interface StylePalette {
  name: string;
  walls: string[];
  roofs: string[];
  trim: string;
  glass: string;
  roof: 'gable' | 'hip' | 'flat' | 'steep' | 'curved';
  needs?: string;
}

export const STYLES: Record<Style, StylePalette> = {
  european: { name: 'European historic', walls: ['#d8d2c4', '#bfb6a5', '#e6e0d2', '#a69c8b'], roofs: ['#4a4f57', '#3b3f46', '#5a5149'], trim: '#efe9dc', glass: '#3a4a58', roof: 'steep' },
  mediterranean: { name: 'Mediterranean coastal', walls: ['#f4efe4', '#efe3c9', '#e9d3ae', '#f6f3ec'], roofs: ['#c0623b', '#b5573a', '#cf7348'], trim: '#5a86b5', glass: '#2f4a63', roof: 'hip' },
  tropical: { name: 'Tropical modern', walls: ['#f3f1ea', '#e9e2d0', '#d9e6e0', '#f0e6d6'], roofs: ['#7b5a3a', '#8d6b47', '#5f6f62'], trim: '#a07848', glass: '#2c5d63', roof: 'gable' },
  highrise: { name: 'High-rise', walls: ['#9fb2c2', '#b7c3cc', '#8899a8', '#c8d0d6'], roofs: ['#5d6872', '#4b545c'], trim: '#e6ecf0', glass: '#4b7896', roof: 'flat', needs: 'highrise' },
  futuristic: { name: 'Futuristic', walls: ['#f2f6f8', '#e2ecf1', '#d5e5ee'], roofs: ['#9cc9db', '#7fb6cc'], trim: '#3ad1c4', glass: '#5aa8c8', roof: 'curved', needs: 'futurism' },
  rural: { name: 'Rural timber', walls: ['#8b6a4a', '#9a7b58', '#a8916f', '#c2b29a'], roofs: ['#5c3f2c', '#46505a', '#6b4b35'], trim: '#e8dfcf', glass: '#2e3b44', roof: 'gable' },
  industrial: { name: 'Industrial', walls: ['#a4a9ad', '#8e9599', '#b8b2a6', '#7f8a94'], roofs: ['#5f666b', '#6f7c84'], trim: '#d0a040', glass: '#3c4952', roof: 'flat' },
};

export const PLAYER_STYLES: Style[] = ['european', 'mediterranean', 'tropical', 'rural', 'highrise', 'futuristic'];
