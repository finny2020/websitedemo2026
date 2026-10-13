# Wet Ink Studio — website

Static site, no build step. Open `index.html` or serve the folder (`npx serve .`).

```
index.html      markup
css/style.css   design tokens + all styles
js/main.js      interactions (ink canvas, mascot, scroll story, work list, archive wheel)
```

## Identity

Built from three moodboard references: Art_Pill (dark 3D chapter, exploded disc stack, 3D project
carousel), Daniele Buffa's "Design is Funny" (huge grotesk, playful type), and Project Yuli
(paper stock, mascot, quoted labels).

- **Concept:** ink that is still wet. It spreads, pools, runs down the page and dries.
- **Colour:** greige stock, process black as the main colour, Riso orange as a sparing accent.
- **Type:** Archivo (variable width) and Instrument Serif italic. Fraunces appears only inside archive mock-ups.
- **Mascot:** "Blot", the orange ink drop that is the dot of the ı in "ink". It is also the logo
  and the falling drop in the process chapter.

## Interactions

Motion follows Apple's fluid-interface principles (WWDC "Designing Fluid Interfaces"): a small
spring engine in `js/main.js` (damping ratio + response), velocity handoff on release,
momentum projection for flicks, rubber-banding, and feedback on pointer-down.

1. Header: a floating glass capsule; the active-section pill slides on a spring and the glass
   turns dark over the black chapters.
2. Ink: a WebGL layer over the whole page. An orange trail follows the pointer everywhere; pressing
   in the hero drops black ink (splashes inherit the stroke's velocity). Edges are thresholded at
   full device resolution and lit with a small specular highlight so the ink looks wet.
   Blot can be grabbed, dragged on a rubber-band leash and thrown; a hard throw splashes where
   the momentum would land, then Blot springs home carrying your release velocity.
3. Ticker: drifts slowly and picks up the speed and direction of your scroll.
4. Process: scroll-linked; discs open and a red drop falls through five passes. Lines enter
   from below going forward and from above going back.
5. Archive: 1:1 drag, flick projection, snap to a piece, tap a side piece to bring it forward,
   arrow keys, buttons and trackpad side-swipes. Tap the front piece (or Open) and a sheet grows
   out of it; drag the sheet's handle down to dismiss. Six pieces are working mock websites
   (Kiln shop, Northlight reel, Atlas type tester, Pause radio, Halo booking, Oddly menu).
6. Services: ink floods in from where the pointer enters and drains out where it leaves.
7. Contact: tap the address to copy it. Footer letters lean toward the pointer.

`prefers-reduced-motion`, `prefers-reduced-transparency` and `prefers-contrast` are all handled.

## Placeholder content

The archive pieces are examples until real work arrives (`ARCHIVE` and `SITES` in
`js/main.js`). The email address is a placeholder; Instagram is @wetink.studio.
