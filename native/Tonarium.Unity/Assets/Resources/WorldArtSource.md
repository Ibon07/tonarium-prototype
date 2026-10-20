# Web 3D world art

The geometry, dimensions, colors, cafe furniture and game tower are ported from
`client/src/view3d/worlds3d.tsx`, `client/src/view3d/game3d.tsx`,
`client/src/view3d/parts3d.tsx`, `shared/worlds.ts`, and `shared/game.ts`.

`CafeMenu.png` reproduces the Web `MenuBoard` 1024 × 640 canvas. Regenerate it with
`native/Tonarium.Unity/Tools/Export-CafeMenu.ps1`; the Japanese menu and prices are
read directly from `worlds3d.tsx`. It uses the same Segoe UI font and Windows font
fallback as the Web canvas.

`WorldEnvironmentDetails.PlankTexture()` uses the Web `usePlankTexture` algorithm,
including JavaScript's signed remainder behavior, 1024 × 1024 pixels, 16 rows,
6 × 6 repetition and anisotropy 4. The texture is generated once per cafe load.

Spawn and game participation markers use the same radius, ring width, colors and
opacity as the Web meshes. No external illustration or replacement world model
is used.
