# Manual QA checklist

Automated coverage lives in `tests/` (`npm test`). These are the flows that
need a human in a real browser — run through them before publishing a new
version to the Chrome Web Store.

## Setup

```sh
open -na "Google Chrome" --args \
  --user-data-dir=/tmp/noizy-qa-profile \
  --load-extension="$(pwd)"
```

Pin Noizy via the puzzle-piece menu. The toolbar should show the colorful
equalizer-bars icon (not a grey placeholder) at crisp resolution.

## Popup

- [ ] Popup opens showing CUSTOMIZATION / BROWSING / SIGNED-IN SITES / BRAINROT sections.
- [ ] "Click me to change palette" cycles palettes; the hero updates.
- [ ] **Options opens as a full browser tab**, not inside the popup (regression check).

## Options page

- [ ] Page uses the dark theme and fills the window; text boxes are large.
- [ ] Palette dropdown, websites list, signed-in sites, and search terms are populated.
- [ ] Save shows the confirmation alert; reopening the page shows the saved values.
- [ ] Reset restores the default website list.

## Noise session (core feature)

- [ ] Start a browsing/exploration run from the popup; tabs open, scroll, and navigate.
- [ ] With auto-close enabled, tabs close after exploration finishes.
- [ ] Stop ends the run; no new tabs appear afterwards.
- [ ] chrome://history shows the visited noise sites.

## Signed-in sites (read-only mode)

- [ ] Start a read-only session; sites open and scroll only — no clicks/likes/posts.
- [ ] Background run survives closing the popup; "Stop background run" halts it.

## Theming

- [ ] "Apply to page" recolors the active tab; page stays usable (links, inputs readable).
- [ ] Reset/reload restores the page's original look.
