# Wet Ink Studio — project notes

## Design rules (v4, set by the user: minimal, sharp, luxury tech + 19th-century engraved paper)
- **Serif only:** Bodoni Moda (opsz 6–96, 400–900, italic). No sans-serif anywhere. Never use JetBrains Mono.
- **No micro labels:** no small tracked uppercase text, eyebrows, kickers, `[ 01 ]` numbers, tags, hints, HUDs or meta lines.
  Keep text to the minimum: one line per section.
- **Colour:** grounds are only black `#050505`, white paper `#F6F5F1`, fluorescent green `#C6FF1A`, fluorescent pink `#FF3EC8`.
  Light comes from chrome (`--chrome` gradient) and iridescence (pink, violet, sky, mint). **No orange. No red.**
- **Sharp:** border-radius 0 everywhere, 1px hairlines.
- **Texture/effects:** film grain, laid-paper texture on white, generated guilloche (banknote engraving) rosettes and bands,
  chrome four-point sparkles, chrome text whose sheen follows the pointer, iridescent WebGL form in the hero.
- **3D, not flat:** the blob, star, hook, glints, Blot and the "Wet ınk" / "Archive" / footer WET INK type are real 3D in
  js/scene3d.js (Three.js r170, vendored in vendor/; marching-cubes blob; extruded bevelled type from Bodoni Moda outlines in
  assets/fonts/*.typeface.json; MeshPhysicalMaterial chrome with iridescence + clearcoat; PMREM studio environment with coloured
  softboxes). The HTML text stays underneath for layout and accessibility (`.has3d` hides its paint). Needs http(s), not file://.
  To add letters to the 3D type, regenerate the typeface JSON (fontTools script in the commit history).
- The hero word is "Wet ink": "ink" is set with a dotless ı and Blot (chrome) sits as its dot.

## Motion rules (Apple fluid-interface principles)
- Anything a person can grab runs on the `Spring` class in js/main.js (damping ratio + response), never CSS transitions.
- Respond on pointer-down; track drags 1:1; hand release velocity to the spring; rubber-band at limits; interruptible.
- No intro screens, custom cursors or input lockouts. Respect reduced motion, reduced transparency and more contrast.
- Heavy layers (WebGL form, sparkles, rosette, archive field) only run while their section is on screen.

## Page structure
Hero (black: iridescent form, guilloche, chrome star, "Wet ınk", "Marks that stay.") → Studio (white laid paper, one sentence,
guilloche band) → Archive (black, abstract field: fragments of the work cut into shapes, blurred and washed in iridescence,
focus on approach, click opens the detail sheet) → Services (fluo green, four words) → Contact (fluo pink) → footer (chrome WET INK).

## Content
- Instagram: @wetink.studio — https://www.instagram.com/wetink.studio/
- Email shown: hello@wetink.studio (placeholder until confirmed).
- Archive = client work only (images in assets/archive/): Escu & Co. website, Quiet Luxury / Loud Feet socks (interactive),
  colour pencil boxes, Jus d'Art carton + label, Printing Studio postcard. Concept pieces were removed.
  Never invent years, clients or details for client work.
- Ink is a page-wide WebGL layer in fluo pink and green. Keep it smooth: threshold at full device resolution.
