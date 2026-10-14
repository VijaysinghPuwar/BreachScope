export type Projection = 'Flat' | 'Globe';
export const layerDefinitions = [
  ['arcs', 'Arcs', 'TEL, AGG'],
  ['points', 'Points', 'TEL sources, IOC'],
  ['density', 'Hex density', 'Events per cell'],
  ['sensors', 'Sensors', 'Configured coordinates'],
  ['accuracy', 'Accuracy rings', 'True radius in km'],
  ['borders', 'Country borders', 'Natural Earth'],
  ['graticule', 'Graticule', 'Globe only'],
] as const;
export type LayerKey = (typeof layerDefinitions)[number][0];
export type Layers = Record<LayerKey, boolean>;
export const defaultLayers: Layers = {
  arcs: true,
  points: true,
  density: false,
  sensors: true,
  accuracy: true,
  borders: true,
  graticule: true,
};
export interface MapActions {
  zoom(delta: number): void;
  reset(): void;
}
