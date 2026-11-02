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

## Structure

Rebuilt with the MotionSites web-builder workflow (brief → closest references → spec → build →
screenshot review). One signature, everything else quiet:

1. **Hero:** a sheet of paper inset in a black page. Giant "Wet ınk" with Blot as the dot, a short
   lede and one CTA. The ink on the sheet is live: an orange trail follows the pointer, pressing drops
   black ink, Blot can be thrown.
2. **Ticker:** drifts, and picks up the speed and direction of your scroll.
3. **[01] Studio:** a manifesto read at scroll pace (each word's opacity follows the scroll, 1:1),
   then four facts.
4. **[02] Archive:** the 3D wheel (1:1 drag, flick projection, snap) and the detail sheet that grows out
   of the piece you open (drag down to dismiss). Client work first, then two concept studies.
5. **[03] Services:** four editorial rows on paper; black ink floods each row from where you enter.
6. **[04] Contact:** tap the address to copy it; Instagram link. Footer letters lean toward the pointer.

Motion follows Apple's fluid-interface rules: a small spring engine in `js/main.js` (damping ratio +
response), velocity handoff on release, momentum projection, rubber-banding, feedback on press.
Entrances finish within about 1.5 s and the page is fully visible without JavaScript.
`prefers-reduced-motion`, `prefers-reduced-transparency` and `prefers-contrast` are all handled.

## Placeholder content

The archive starts with client work (images in `assets/archive/`), followed by concept studies
labelled as such. Add a piece by appending to `ARCHIVE` in `js/main.js` with `client: true` and an
`images` list. The email address is a placeholder; Instagram is @wetink.studio.
