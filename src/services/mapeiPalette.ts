export interface MapeiColor {
  code: string;
  class: string;
  rgb: [number, number, number];
  hex: string;
}

let paletteCache: MapeiColor[] | null = null;

/**
 * Loads the JSON file and stores it in memory.
 */
export async function loadMapeiPalette(): Promise<MapeiColor[]> {
  if (paletteCache) return paletteCache;
  
  const response = await fetch('/mapei-master-1002.json');
  if (!response.ok) {
    throw new Error('Failed to load Mapei palette file');
  }
  
  paletteCache = await response.json();
  return paletteCache || [];
}

/**
 * Returns the matching color object by code.
 */
export async function getMapeiColorByCode(code: string): Promise<MapeiColor | null> {
  const palette = await loadMapeiPalette();
  const normalizedCode = code.trim().toLowerCase();
  return palette.find(c => c.code.toLowerCase() === normalizedCode) || null;
}

/**
 * Filters colors by code.
 */
export async function searchMapeiColors(term: string): Promise<MapeiColor[]> {
  const palette = await loadMapeiPalette();
  const normalizedTerm = term.trim().toLowerCase();
  if (!normalizedTerm) return [];
  return palette.filter(c => c.code.toLowerCase().includes(normalizedTerm));
}
