# Wet Ink Studio — website

Static site, no build step. Serve the folder over http (`npx serve .`); the 3D layer is an ES module and does not load from `file://`.

```
index.html      markup
css/style.css   design tokens + all styles
js/main.js      interactions (ink canvas, mascot, scroll story, work list, archive wheel)
```

## Direction

Minimal luxury tech with a 19th-century engraved-paper feeling. Serif only (Bodoni Moda), sharp corners, black, white
laid paper, fluorescent green and fluorescent pink, with chrome and iridescent light.

0. **3D layer (`js/scene3d.js`):** Three.js (vendored in `vendor/`) renders everything shiny as real geometry with physically
   based materials lit by a coloured studio environment: a marching-cubes metaball blob, a bevelled chrome star and hook,
   chrome glints, Blot as a glossy teardrop, and extruded chrome type fitted over the HTML text.
1. **Hero:** an iridescent form (raymarched metaballs with a rainbow thin-film rim and grain) floating over a slowly
   turning guilloche rosette, a chrome four-point star and chrome sparkles. The pointer pulls the form; pressing makes it
   swell and throws sparkles. Chrome "Wet ınk" wordmark with Blot as the dot.
2. **Studio:** one sentence on laid paper, then an engraved guilloche band.
3. **Archive:** an abstract field. Fragments of the work, cut into stars, diamonds, slivers and arches, drift at different
   depths, blurred and washed in iridescence. They come into focus as you approach; click to open the piece.
4. **Services:** four words on fluorescent green; black ink floods a row from where you enter.
5. **Contact:** fluorescent pink, tap-to-copy email and Instagram.

Interactions run on springs (`js/main.js`); reduced motion, reduced transparency and more contrast are handled.

## Placeholder content

The archive starts with client work (images in `assets/archive/`), followed by concept studies
labelled as such. Add a piece by appending to `ARCHIVE` in `js/main.js` with `client: true` and an
`images` list. The email address is a placeholder; Instagram is @wetink.studio.
