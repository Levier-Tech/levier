// Shared constants for the hero race scene.

export interface RiderSpec {
  ticker: string;
  name: string;
  image: string;
  /** Livery color (bike fairing, suit). */
  color: number;
  /** Color of the logo decals on the livery. */
  logoColor: number;
  /** Helmet base color. */
  helmet: number;
}

// Brand colors follow the hero card colors in globals.css (.tesla, .amazon, ...).
const BRAND: Record<string, Pick<RiderSpec, 'color' | 'logoColor' | 'helmet'>> = {
  tesla: { color: 0xf94738, logoColor: 0xffffff, helmet: 0xf2f2f2 },
  amazon: { color: 0xf2ab35, logoColor: 0x0a0a0a, helmet: 0x141414 },
  palantir: { color: 0x7fa7de, logoColor: 0x0a0a0a, helmet: 0xf2f2f2 },
  netflix: { color: 0xe9e6de, logoColor: 0xd6153c, helmet: 0x141414 },
  amd: { color: 0xbded35, logoColor: 0x0a0a0a, helmet: 0x141414 },
};
const FALLBACK = { color: 0xc2ff47, logoColor: 0x0a0a0a, helmet: 0xf2f2f2 };

export function riderSpec(asset: { ticker: string; name: string; image: string; className: string }): RiderSpec {
  return { ticker: asset.ticker, name: asset.name, image: asset.image, ...(BRAND[asset.className] ?? FALLBACK) };
}

// Realistic bike model: "2021 Ducati Panigale V4 SP" by Gratisphile, CC-BY-4.0 (see public/models/superbike.license.txt).
// Simplified, recompressed (meshopt + webp) and stripped of the original livery text. Set to '' for the procedural bike.
export const BIKE_MODEL_URL = process.env.NEXT_PUBLIC_HERO_BIKE_URL ?? '/models/superbike.glb';

// Orientation and size of the glb (meters, bike faces +X), and which materials are paint and tyres.
export const BIKE_MODEL_CONFIG = {
  length: 2.1,
  rotationY: 0,
  paintNames: /livery/i,
  wheelNames: /tyre|tire/i,
};
