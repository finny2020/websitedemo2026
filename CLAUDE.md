# Wet Ink Studio — project notes

## Design rules
- Never use **JetBrains Mono** (on this site or any future project for this user).
  Small labels, nav and captions use Archivo set narrow: `font-family: var(--label); font-stretch: 80%; font-weight: 600`, uppercase, slight tracking.
- Type: Archivo (display + body, variable width) and Instrument Serif italic for the one emphasised word per heading.
- Colour: paper `#E8E3D6`, ink `#131214`, one spot red `#E2231A`. Riso inks only inside artwork covers.

## Motion rules (Apple fluid-interface principles)
- Anything a person can grab runs on the `Spring` class in js/main.js (damping ratio + response), never CSS transitions.
  Default damping 1.0; bounce (~0.55–0.8) only after a throw or flick.
- Respond on pointer-down; track drags 1:1 from the grab point; 10px hysteresis before committing to a drag.
- On release, hand pointer velocity to the spring; project flicks with `project()` and snap from the projected point.
- Grabbing a moving element stops it at its current on-screen value (interruptible). Rubber-band at limits.
- No intro screens, custom cursors or input lockouts. Respect reduced motion, reduced transparency and more contrast.
- Chrome is a floating glass capsule (`backdrop-filter`), darker material over ink-black sections.

## Content
- Instagram: @wetink.studio — https://www.instagram.com/wetink.studio/
- Email shown: hello@wetink.studio (placeholder until confirmed).
- The "Selected work" section is removed for now; the user will supply past-work and archive images.
  The archive carousel currently shows generated placeholder covers (`ARCHIVE` in js/main.js).
