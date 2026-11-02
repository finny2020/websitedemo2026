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

Direction: object-led and editorial (references: Poch, BORN, Detroit, OUS Worldwide and an object-tunnel video),
calm enough for corporate clients. Built with the MotionSites web-builder workflow (brief, references, spec,
build, screenshot review).

1. **Hero, the object tunnel:** one of the studio's real products repeated on the walls of a tunnel that drifts
   toward you. Move the pointer to steer it and change the scale (shown live), press "Next object" to swap the
   product. Giant "wet ınk" with Blot as the dot, a one-line statement and "Start a project".
2. **[01] Studio:** a mixed-type lockup ("WET INK® IS A CREATIVE STUDIO"), a stack of services in alternating
   type, and two plain paragraphs for people who sign the brief.
3. **[02] Archive:** the 3D wheel and the detail sheet (client work first, then two concepts).
4. **[03] Team:** eight role pills on a hand-drawn line around "MANY HANDS, ONE MARK." Drag or throw a pill and the
   line follows; arrow keys move a focused pill.
5. **[04] Services:** condensed editorial rows; black ink floods a row from where you enter.
6. **[05] Contact:** "LET'S MAKE SOMETHING PEOPLE keep." with tap-to-copy email and Instagram.

The orange ink trail (WebGL) follows the pointer across the page, and pressing in the hero drops ink. Springs drive
everything you can grab (`js/main.js`). Reduced motion, reduced transparency and more contrast are handled.

## Placeholder content

The archive starts with client work (images in `assets/archive/`), followed by concept studies
labelled as such. Add a piece by appending to `ARCHIVE` in `js/main.js` with `client: true` and an
`images` list. The email address is a placeholder; Instagram is @wetink.studio.
