Edu's app icon depicts three equally sized thick hardcover books resting on
one another. The yellow book's cover depth and page-block thickness are restored
to match the blue and green books while preserving its stronger rotation.
Their balanced horizontal offsets follow the supplied sketch: blue on top
shifted right, sage in the middle shifted left, and gold underneath between
the other two. All books touch. The books have rounded spines,
ivory page blocks with only two faint lines, and front and back covers with a
small overhang. Their angles progress like a staircase: blue is nearly level,
green turns counterclockwise, and yellow has a pronounced further turn in the
same direction, making the staircase progression clearer.
There are no binding bands, stars, ornaments, or ground shadow.
The staggered offsets and natural contact between the books are preserved.
The palette is based on the book colors in `app/globals.css`: blue
`#a5c0cd` / `#6e95a8`, sage `#a4bfa9` / `#718d77`, gold
`#e9c76c` / `#b99541`, and ivory paper `#fffdf4`.
The background is transparent. Exports trim the transparent margins and fit
the stack to the entire horizontal width of the square icon without clipping
the books. The remaining space above and below the stack is transparent.

Source: `public/brand/edu-books-artwork.png`

Created using the built-in imagegen tool. The full generation and refinement
prompts are saved in `books-imagegen-prompts.txt`. The previous SVG draft is
preserved as `public/brand/edu-books-icon-draft.svg`.

Regenerate exports with `pnpm icons:build`:

- `public/brand/edu-books-icon.png` — 1024 × 1024 master
- `app/icon.png` — 512 × 512 app icon
- `app/apple-icon.png` — transparent 180 × 180 Apple touch icon
- `app/favicon.ico` — 16, 24, 32, 48, 64, 128, and 256 pixel images
- `../desktop/src/renderer/assets/app-icon.png` — 1024 × 1024 desktop asset with optical padding

The desktop asset places the same artwork in an 840 pixel square centered on
its transparent 1024 pixel canvas. This reduces the stack's visual weight next
to the wordmark while preserving the existing 44 pixel image element, spacing,
colors, and sidebar styles. Only the asset's proportions change.

Next.js discovers these files through its metadata file conventions.
The previous active exports and build script are preserved in `before-books/`;
the earlier artwork remains in `public/brand/edu-icon.svg` and `edu-icon.png`.
The four-book version is preserved in `before-e/`.
The artwork before the alignment and color refinement is in `before-alignment/`.
The previous yellow-background artwork is in `before-transparency/`.
The artwork before the page-line and angle refinement is in `before-page-lines-angles/`.
The artwork before the yellow book's angle adjustment is in `before-yellow-angle/`.
The artwork before the staircase correction is in `before-staircase-angle/`.
The artwork before the stronger yellow tilt is in `before-stronger-tilt/`.
The artwork before the yellow size correction is in `before-equal-size-correction/`.
