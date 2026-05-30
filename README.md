# The Three Notebooks

A static, JSON-driven flipbook viewer that renders three themed notebooks —
**Ingredients**, **Potion Recipes**, and **An Alchemist's Textbook** — as a
single centered bookshelf.

The previous alchemy engine (cauldron, brewing resolver, journal, DM panel)
has been stripped out. All that remains is the bookshelf, the leather-bound
covers, and the flippable parchment pages. Content is intentionally empty
right now — the books are placeholders waiting for entries that a separate
content system will produce.

## How it works

- `index.html` renders a centered "workbench" containing a Turn.js flipbook
  surface. No header, no tabs, no other UI.
- On load, `js/app.js` fetches `data/pages.json` and hands it to
  `js/ui.js`, which builds the closed-book stack first. Use the mouse,
  arrow keys, or Enter/Space to pick a book and open it.
- Each book is a Turn.js flipbook with hard front and back covers wrapping
  the content pages. The page packer measures real DOM heights so prose
  flows naturally across as many pages as it needs.
- Empty books (no `pages` array entries) show a single "Entries forthcoming"
  placeholder so the cover, binding, and back cover still flip correctly.

## Project layout

```
.
├── index.html              # minimal centered shell
├── styles.css              # ambient + book/cover/page styling (unchanged)
├── js/
│   ├── app.js              # entry: fetch pages.json, init UI
│   └── ui.js               # bookshelf, covers, page packer, Turn.js wiring
├── data/
│   └── pages.json          # the three books + their pages
├── libraries/turnjs4/      # Turn.js + jQuery 1.7 (vendored)
└── README.md
```

## Editing the books

All content lives in [`data/pages.json`](data/pages.json). The schema is
intentionally tiny:

```json
{
  "books": [
    {
      "id": "ingredients",
      "title": "Ingredients",
      "subtitle": "Field Catalogue",
      "glyph": "🌿",
      "theme": "blue",
      "coverStats": "",
      "pages": [
        {
          "title": "Optional chapter title",
          "subtitle": "Optional chapter subtitle",
          "sections": [
            {
              "heading": "Optional section heading",
              "body": [
                "Each string in this array becomes its own paragraph.",
                "A plain string is also accepted instead of an array."
              ]
            }
          ]
        }
      ]
    }
  ]
}
```

- `theme` controls the cover color: `"blue"`, `"red"`, or `"green"`.
- `glyph` is rendered as the front-cover emblem.
- `coverStats` is an optional small text line under the subtitle on the
  cover (e.g. `"24 entries catalogued"`). Leave empty to omit.
- `pages` may be `[]` while the upstream content system is still being
  written; the book just shows a single placeholder leaf in that state.

Bodies are escaped — no raw HTML. The successor system can write straight
to this schema, or call out for a different export format later if more
markup expressiveness is needed.


All asset paths in the project are relative, so the same build works whether
it's served from the site root or under a subpath.

## Controls

- **Click a book** in the stack to select it; click again to open.
- **Drag a page corner** or **click the page edge** to flip.
- **← / →** flip pages while a book is open; cycle the stack selection
  while no book is open.
- **↑ / Enter / Space** open the selected book from the stack.
- **↓** closes the open book and returns to the stack.
- The **Book Select** pill (top-right of the open book) returns to the
  stack without using the keyboard.

## On a phone

The two-page spread needs width a portrait phone doesn't have, so on narrow
portrait screens the whole interface rotates 90° — it's meant to be read with
the phone held sideways (turn the phone, or just rotate the device if
auto-rotate is on). Because a CSS rotation would break Turn.js's drag-to-flip
math, the open book gets invisible **tap zones**: tap the right side to flip
forward, the left side to flip back.
