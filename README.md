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
- **Type:** Archivo (variable width; expanded black for display, italic for the work list),
  Instrument Serif italic for the one emphasised word per heading, JetBrains Mono for labels.
- **Mascot:** "Blot", the ink drop that sits on the dotless ı of "Ink". The same drop is the
  logo, the cursor and the falling drop in the process chapter.
- **Print vernacular:** registration marks, halftone dots, Riso ink names, paper spec in the footer.

## Interactions

1. Intro: a drop falls and floods the screen red.
2. Hero: move to draw with ink, click to drop a splash (metaball canvas with a darker dried rim);
   Blot's eyes follow the cursor and it splashes when poked.
3. Process: sticky dark chapter; five discs open up as you scroll and a red drop falls through them.
4. Work: hover list with a cover that trails the cursor; click a row to open details.
5. Archive: draggable 3D ring of covers (arrow keys work too).
6. Services: red ink floods each cell from where the pointer enters.
7. Footer: letters drip when hovered.

All motion respects `prefers-reduced-motion`.

## Placeholder content

Project names, descriptions, the email address and social links are placeholders.
Replace `PROJECTS` and `ARCHIVE` in `js/main.js` and the copy in `index.html`.
