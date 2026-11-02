# Wet Ink Studio — project notes

## Design rules (v4, set by the user: minimal, sharp, luxury tech + 19th-century engraved paper)
- **Serif only:** Bodoni Moda (opsz 6–96, 400–900, italic). No sans-serif anywhere. Never use JetBrains Mono.
- **No micro labels:** no small tracked uppercase text, eyebrows, kickers, `[ 01 ]` numbers, tags, hints, HUDs or meta lines.
  Keep text to the minimum: one line per section.
- **Colour:** grounds are only black `#050505`, white cotton paper (assets/paper.webp), fluorescent green `#C6FF1A`, and a
  **dreamy pink** `#FF8AD8` washed with lavender, peach and sky (user asked for the pink to be dreamier).
  Light comes from chrome (`--chrome` gradient) and iridescence (pink, violet, sky, mint). **No orange. No red.**
- **Sharp:** border-radius 0 everywhere, 1px hairlines.
- **Texture/effects:** film grain, guilloche rosette behind the hero, a guilloche band above the footer, generated guilloche (banknote engraving) rosettes and bands,
  chrome four-point sparkles, chrome text whose sheen follows the pointer, iridescent WebGL form in the hero.
- **3D, not flat:** the blob, star, hook, glints, Blot and the "Wet ınk" / "Archive" / footer WET INK type are real 3D in
  js/scene3d.js (Three.js r170, vendored in vendor/; marching-cubes blob; extruded bevelled type from Bodoni Moda outlines in
  assets/fonts/*.typeface.json; MeshPhysicalMaterial chrome with iridescence + clearcoat; PMREM studio environment with coloured
  softboxes). The HTML text stays underneath for layout and accessibility (`.has3d` hides its paint). Needs http(s), not file://.
  To add letters to the 3D type, regenerate the typeface JSON (fontTools script in the commit history).
- **Studio section must stay minimal** (user found the paper/frame/seal/symbols version cheap): only the 3D white liquid
  surface (ripples under the pointer, no ink trail, no glints there) and the icy 3D sentence "Drawn by hand, / finished
  like jewellery." The liquid uses its own white environment (milkEnv), the ice its own cold environment (iceEnv).
- Services words are Bodoni 700 at opsz 28 so the hairlines survive on fluo green.
- The hero word is "Wet ink": "ink" is set with a dotless ı and Blot (chrome) sits as its dot.

## Motion rules (Apple fluid-interface principles)
- Anything a person can grab runs on the `Spring` class in js/main.js (damping ratio + response), never CSS transitions.
- Respond on pointer-down; track drags 1:1; hand release velocity to the spring; rubber-band at limits; interruptible.
- No intro screens, custom cursors or input lockouts. Respect reduced motion, reduced transparency and more contrast.
- Heavy layers (WebGL form, sparkles, rosette, archive field) only run while their section is on screen.

## Page structure
Hero (black: 3D iridescent blob, guilloche, puffy chrome star, "Wet ınk", "Marks that stay.") → Studio (3D: icy type on a rippling white liquid, nothing else) → Archive (black, one short strip of six tiles) → Services (fluo green, four words) → Contact (dreamy pink, heavier weight for legibility) → footer (chrome WET INK).

## Content
- Instagram: @wetink.studio — https://www.instagram.com/wetink.studio/
- Email shown: hello@wetink.studio (placeholder until confirmed).
- The studio is new and has no client portfolio. Archive = one short strip: the Quiet Luxury / Loud Feet socks (team's own
  work, opens in the sheet) + five 3D concept studies drawn live in js/scene3d.js (Pearl, Orbit, Fuzz, Coral, Melt; drag to
  spin), inspired by the user's moodboards. The team will make more concept pieces; swap studies in by adding a
  `.piece[data-obj]` tile and a matching entry in `studies`. Escu & Co., pencil boxes, Jus d'Art and postcard were removed
  at the user's request. Never present concept pieces as client work or invent clients.
- Ink is a page-wide WebGL layer rendered as **glass** (clear body, refraction rim, thin-film rainbow, glints), pink and mint. Keep it smooth: threshold at full device resolution.
