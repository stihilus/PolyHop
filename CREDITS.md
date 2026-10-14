# Credits

PolyHop is built on these open source projects and assets.

## Code

| Project | Used for | License |
| --- | --- | --- |
| [three.js](https://threejs.org) | 3D rendering in the editor and in exported games | MIT |
| [fflate](https://github.com/101arrowz/fflate) | the zip of an exported game | MIT |
| [Vite](https://vitejs.dev), [Vitest](https://vitest.dev), [TypeScript](https://www.typescriptlang.org) | build and test tooling | MIT / Apache-2.0 |

## Font

**Inter** by The Inter Project Authors (<https://github.com/rsms/inter>), used for the editor and the on-screen HUD of
games (`assets/fonts/Inter.woff2` is a Latin subset of Inter 4.0 with the weights 400 to 700).
SIL Open Font License 1.1, the license text is in `assets/fonts/OFL.txt`.

## Art and sound made for PolyHop

The tile atlases `Kit-16`, `Props-16`, `Items-16`, `Plants-16` and `Demo-16`, the character skins and rig, the
built-in models and every built-in sound effect and music loop are made by
the scripts in `tools/` (and by the generators in `src/core/sfx.ts` and `src/core/music.ts`), so there is nothing to
attribute for them.

`assets/textures/Textures-16.png` and `assets/textures/Seamless-16.png` are 16 × 16 px tile sets supplied by the
project author.

## License of PolyHop itself

PolyHop is released under the MIT License, see `LICENSE`. The font above is under the SIL Open Font License, the
libraries in the first table under their own licenses.
