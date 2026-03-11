export interface MapeiColor {
  code: string;
  class: string;
  rgb: [number, number, number];
  hex: string;
  hsl?: { h: number; s: number; l: number };
  familyId?: string;
}

export interface ColorFamily {
  id: string;
  label: string;
  hex: string;
  variants: MapeiColor[];
}

let paletteCache: MapeiColor[] | null = null;
let groupedCache: ColorFamily[] | null = null;

/**
 * Converts RGB to HSL.
 */
function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0, l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }

  return { h: h * 360, s: s * 100, l: l * 100 };
}

/**
 * Assigns a color to a family bucket based on HSL.
 */
function getFamilyId(h: number, s: number, l: number): string {
  if (s < 12) return 'neutrals';
  if (h < 15 || h >= 345) return 'reds';
  if (h < 45) return 'oranges';
  if (h < 70) return 'yellows';
  if (h < 100) return 'yellow-greens';
  if (h < 150) return 'greens';
  if (h < 190) return 'teals';
  if (h < 250) return 'blues';
  if (h < 280) return 'blue-violets';
  if (h < 345) return 'violets';
  return 'neutrals';
}

const FAMILY_DEFS = [
  { id: 'reds', label: 'Reds', hex: '#e11d48' },
  { id: 'oranges', label: 'Oranges', hex: '#ea580c' },
  { id: 'yellows', label: 'Yellows', hex: '#ca8a04' },
  { id: 'yellow-greens', label: 'Yellow-Greens', hex: '#65a30d' },
  { id: 'greens', label: 'Greens', hex: '#16a34a' },
  { id: 'teals', label: 'Teals', hex: '#0d9488' },
  { id: 'blues', label: 'Blues', hex: '#2563eb' },
  { id: 'blue-violets', label: 'Blue-Violets', hex: '#4f46e5' },
  { id: 'violets', label: 'Violets', hex: '#9333ea' },
  { id: 'neutrals', label: 'Neutrals', hex: '#525252' },
];

/**
 * Loads the JSON file and stores it in memory.
 */
export async function loadMapeiPalette(): Promise<MapeiColor[]> {
  if (paletteCache) return paletteCache;
  
  const response = await fetch('/mapei-master-1002.json');
  if (!response.ok) {
    throw new Error('Failed to load Mapei palette file');
  }
  
  const rawPalette: MapeiColor[] = await response.json();
  
  // Enrich with HSL and family info
  paletteCache = rawPalette.map(c => {
    const hsl = rgbToHsl(c.rgb[0], c.rgb[1], c.rgb[2]);
    return {
      ...c,
      hsl,
      familyId: getFamilyId(hsl.h, hsl.s, hsl.l)
    };
  });

  return paletteCache;
}

/**
 * Returns the grouped palette structure.
 */
export async function getGroupedPalette(): Promise<ColorFamily[]> {
  if (groupedCache) return groupedCache;

  const palette = await loadMapeiPalette();
  
  const families: ColorFamily[] = FAMILY_DEFS.map(def => ({
    ...def,
    variants: palette
      .filter(c => c.familyId === def.id)
      .sort((a, b) => {
        // Sort by lightness (lighter to darker)
        if (a.hsl!.l !== b.hsl!.l) return b.hsl!.l - a.hsl!.l;
        // Then saturation
        if (a.hsl!.s !== b.hsl!.s) return b.hsl!.s - a.hsl!.s;
        // Then hue
        return a.hsl!.h - b.hsl!.h;
      })
  }));

  // Filter out empty families if any
  groupedCache = families.filter(f => f.variants.length > 0);
  return groupedCache;
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
