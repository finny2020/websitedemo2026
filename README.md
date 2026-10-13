# Wet Ink Studio — website

Static site, no build step. Open `index.html` or serve the folder (`npx serve .`).

```
index.html      markup
css/style.css   design tokens + all styles
js/main.js      interactions (ink canvas, mascot, scroll story, work list, archive wheel)
```

## Identity

Built from three moodboard references: Art_Pill (dark 3D scroll chapter, exploded disc stack,
3D project carousel), Daniele Buffa's "Design is Funny" (huge italic grotesk, hover list with a
floating preview), and Project Yuli (paper stock, one loud red, playful mascot, quoted labels).

- **Concept:** ink that is still wet. It spreads, pools, runs down the page and dries.
- **Colour:** greige 120 gsm stock, process black, one spot red ("Wet Red 485 U").
  Riso drum inks (pink, blue, yellow, green) appear only inside project covers.
- **Type:** Archivo (variable width; expanded black for display, narrow for labels and navigation)
  and Instrument Serif italic for the one emphasised word per heading.
- **Mascot:** "Blot", the ink drop that sits on the dotless ı of "Ink". The same drop is the
  logo, the cursor and the falling drop in the process chapter.
- **Print vernacular:** registration marks, halftone dots, Riso ink names, paper spec in the footer.

## Interactions

Motion follows Apple's fluid-interface principles (WWDC "Designing Fluid Interfaces"): a small
spring engine in `js/main.js` (damping ratio + response), velocity handoff on release,
momentum projection for flicks, rubber-banding, and feedback on pointer-down.

1. Header: a floating glass capsule; the active-section pill slides on a spring and the glass
   turns dark over the black chapters.
2. Hero: draw with the pointer, press to drop ink (splashes inherit the stroke's velocity).
   Blot can be grabbed, dragged on a rubber-band leash and thrown; a hard throw splashes where
   the momentum would land, then Blot springs home carrying your release velocity.
3. Ticker: drifts slowly and picks up the speed and direction of your scroll.
4. Process: scroll-linked; discs open and a red drop falls through five passes. Lines enter
   from below going forward and from above going back.
5. Archive: 1:1 drag, flick projection, snap to a piece, tap a side piece to bring it forward,
   arrow keys, buttons and trackpad side-swipes. Grab it mid-spin to stop it.
6. Services: ink floods in from where the pointer enters and drains out where it leaves.
7. Contact: tap the address to copy it. Footer letters lean toward the pointer.

`prefers-reduced-motion`, `prefers-reduced-transparency` and `prefers-contrast` are all handled.

## Placeholder content

The archive covers are generated placeholders until real images arrive (`ARCHIVE` in
`js/main.js`). The email address is a placeholder; Instagram is @wetink.studio.
