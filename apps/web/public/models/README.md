# Hero race bike model

`superbike.glb` is "2021 Ducati Panigale V4 SP" by Gratisphile
(https://sketchfab.com/3d-models/2021-ducati-panigale-v4-sp-8c0632e4c54249758114490390f0b73f),
licensed CC BY 4.0. Full license text: `superbike.license.txt`. The site footer carries the credit.

Changes from the original: livery text and branding removed from the paint texture, textures resized to 1024 px
(paint 2048 px) and converted to WebP, geometry simplified to about 35% and compressed with meshopt.

The hero loads it from `BIKE_MODEL_URL` in `src/components/hero-race/config.ts`. Set
`NEXT_PUBLIC_HERO_BIKE_URL=''` to fall back to the procedural bike.
