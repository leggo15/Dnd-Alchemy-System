// Library UI: three flipbooks (Ingredients, Potion Recipes, An Alchemist's
// Textbook), each loaded from data/pages.json. Stripped from the original
// alchemy app down to just the bookshelf, the covers, the page packer, and
// the Turn.js flip wiring. Content is expected to be supplied by a separate
// system at a later date — for now most books ship empty and fall back to
// a single placeholder leaf.

const $ = (sel, root = document) => root.querySelector(sel);

// Turn.js logical page geometry. The visible book scales to fit its column
// via a CSS transform on the inner `.flip-page`; Turn.js itself always sees
// these constant dimensions so its drag-and-flip geometry stays consistent
// with the off-screen page packer.
const PAGE_FLIP_PAGE_W = 290;
const PAGE_FLIP_PAGE_H = 410;
const PAGE_FLIP_SPREAD_W = PAGE_FLIP_PAGE_W * 2;

// Turn.js needs jQuery on `window`. jQuery 1.7 + turn.min.js are loaded as
// plain <script> tags from libraries/turnjs4 before this module runs.
function getTurn() {
  const jq = window.jQuery || window.$;
  if (jq && jq.fn && typeof jq.fn.turn === "function") return jq;
  return null;
}

// ---------------------------------------------------------------- entry point

export async function initUI(data) {
  const books = Array.isArray(data?.books) ? data.books : [];
  const state = {
    books,
    booksById: Object.fromEntries(books.map((b) => [b.id, b])),
    currentPage: 1,
    pages: [],
    // Turn.js page numbers count from 1 and include the hard covers. The
    // front cover is two pages (closed outer + inside paste-down) and the
    // back cover mirrors that.
    coverFrontCount: 2,
    coverBackCount: 2,
    currentBookId: null,
    selectedBookIndex: 0,
    bookPageById: Object.fromEntries(books.map((b) => [b.id, 1])),
    bookPages: {},
  };

  renderBook(state);
  ensureBookFlipScaleObserver(state);

  document.addEventListener("keydown", (e) => {
    if (document.activeElement?.tagName === "INPUT") return;
    if (state.currentBookId) {
      if (e.key === "ArrowLeft")  flipBook(state, -1);
      if (e.key === "ArrowRight") flipBook(state,  1);
      if (e.key === "ArrowDown") {
        e.preventDefault();
        closeCurrentBookToStack(state);
      }
      return;
    }
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      shiftSelectedStackBook(state, -1);
      renderBook(state);
    }
    if (e.key === "ArrowRight") {
      e.preventDefault();
      shiftSelectedStackBook(state,  1);
      renderBook(state);
    }
    if (e.key === "ArrowUp" || e.key === " " || e.key === "Enter") {
      e.preventDefault();
      openSelectedBook(state);
    }
  });
}

// ============================================================
// Per-book page construction
// ============================================================

// Translate a book's JSON page list into the array of `{ kind: "prose",
// headerHtml, blocks }` records that the renderer expects. Empty books get
// a single placeholder leaf so the cover/binding still flips cleanly.
function buildPagesForBook(book) {
  const inputPages = Array.isArray(book?.pages) ? book.pages : [];
  let prosePages = [];

  for (const page of inputPages) {
    const headerHtml = pageHeaderToHtml(page);
    const blocks = (Array.isArray(page?.sections) ? page.sections : [])
      .map(sectionToBlock)
      .filter(Boolean);
    if (!headerHtml && blocks.length === 0) continue;
    const packed = packPageProseBlocks(blocks, headerHtml);
    for (const p of packed) prosePages.push({ kind: "prose", headerHtml: p.headerHtml, blocks: p.blocks });
  }

  if (prosePages.length === 0) {
    prosePages = [makePlaceholderPage(book)];
  }
  // Turn.js wants an even page count for clean double-page spreads.
  if (prosePages.length % 2 === 1) prosePages.push({ kind: "blank" });
  return prosePages;
}

function pageHeaderToHtml(page) {
  if (!page) return "";
  const title = (page.title || "").trim();
  const subtitle = (page.subtitle || "").trim();
  if (!title && !subtitle) return "";
  const parts = [];
  if (title)    parts.push(`<h2 class="page-title">${escape(title)}</h2>`);
  if (subtitle) parts.push(`<p class="page-subtitle">${escape(subtitle)}</p>`);
  return parts.join("");
}

// A section can express itself with any combination of:
//   heading  — h3-style title with a dashed underline (think \subsubsection)
//   term     — runin bold lead-in attached to the first paragraph of body,
//              rendered as "<strong>Term</strong> body…" (think LaTeX
//              \paragraph{Term} body). A section with `term` and no `body`
//              renders the term alone as a standalone bold paragraph — a
//              cheap way to label a sub-group without escalating to h3.
//   body     — a string or array of strings, each becoming its own <p>.
//   list     — an array of strings, rendered as a bulleted <ul> after body.
//
// Returns a block object `{ html, keepWithNext }` (or null when empty).
// `keepWithNext` flags "header-like" blocks — a bare heading and/or a
// label-only term with no following prose of its own — which the packer
// must never leave dangling at the bottom of a page. Empty inputs are
// skipped so an over-eager section doesn't emit a blank <div> the packer
// would still measure as occupying space.
function sectionToBlock(section) {
  if (!section) return null;

  const heading = section.heading
    ? `<h3>${escape(section.heading)}</h3>`
    : "";

  const term = (section.term ?? "").toString().trim();
  const termLead = term ? `<strong>${escape(term)}</strong> ` : "";

  const bodyArr = Array.isArray(section.body)
    ? section.body
    : (typeof section.body === "string" ? [section.body] : []);

  const bodyParts = [];
  for (let i = 0; i < bodyArr.length; i++) {
    const s = (bodyArr[i] ?? "").toString().trim();
    if (!s) continue;
    const lead = (i === 0 && termLead) ? termLead : "";
    bodyParts.push(`<p>${lead}${escape(s)}</p>`);
  }
  // Whether the section carries real prose of its own (body paragraphs).
  // Computed before the term-only fallback below adds a bare label line.
  const hasRealBody = bodyParts.length > 0;

  // Term provided but no body — render the bolded term alone as a label.
  if (bodyParts.length === 0 && term) {
    bodyParts.push(`<p><strong>${escape(term)}</strong></p>`);
  }

  let listHtml = "";
  if (Array.isArray(section.list) && section.list.length) {
    const items = section.list
      .map((item) => (item ?? "").toString().trim())
      .filter(Boolean)
      .map((s) => `<li>${escape(s)}</li>`)
      .join("");
    if (items) listHtml = `<ul>${items}</ul>`;
  }

  if (!heading && bodyParts.length === 0 && !listHtml) return null;

  // A block is "header-like" when it shows only a heading and/or a bare
  // term label, with no prose body or list of its own. Such a block should
  // travel forward to sit above the content that follows it.
  const keepWithNext = (!!heading || !!term) && !hasRealBody && !listHtml;

  const html = `<div class="page-section">${heading}${bodyParts.join("")}${listHtml}</div>`;
  return { html, keepWithNext };
}

function makePlaceholderPage(book) {
  const title = (book?.title || "Untitled Volume").trim();
  return {
    kind: "prose",
    headerHtml: `
      <h2 class="page-title">${escape(title)}</h2>
      <p class="page-subtitle">Entries forthcoming.</p>
    `,
    blocks: [
      `<div class="page-section"><p>This volume awaits its contents. New entries will be inscribed here once the curator's work is delivered.</p></div>`,
    ],
  };
}

// Pack blocks into prose pages by measuring real DOM heights. Each input
// block is either a plain HTML string or a `{ html, keepWithNext }` object
// (see sectionToBlock); plain strings are treated as keepWithNext:false.
//
// `headerHtml` is rendered ONCE at the top of the first returned page; the
// remaining continuation pages carry no header so titles don't repeat above
// every spill page. Returns `{ headerHtml, blocks }` per produced page,
// where `blocks` is always an array of HTML strings.
//
// Header-like blocks (keepWithNext) are never left dangling at the bottom
// of a page: when a block overflows and the page must be flushed, any
// trailing keepWithNext blocks are peeled off the current page and carried
// forward so they sit directly above the content that follows them.
function packPageProseBlocks(blocks, headerHtml) {
  const headHtml = headerHtml || "";
  // Normalize every input to a { html, keepWithNext } record.
  const norm = (Array.isArray(blocks) ? blocks : [])
    .map((b) => (typeof b === "string" ? { html: b, keepWithNext: false } : b))
    .filter((b) => b && typeof b.html === "string" && b.html.length);

  if (norm.length === 0) {
    return headHtml ? [{ headerHtml: headHtml, blocks: [] }] : [];
  }
  if (typeof document === "undefined" || !document.body) {
    return [{ headerHtml: headHtml, blocks: norm.map((b) => b.html) }];
  }

  const box   = measurePageBox();
  const scope = document.querySelector(".workbench") || document.body;

  const scratch = document.createElement("div");
  scratch.className = "flip-page measure-scratch";
  Object.assign(scratch.style, {
    position: "absolute",
    left: "-99999px",
    top: "0",
    width:  box.width  + "px",
    height: box.height + "px",
    visibility: "hidden",
    pointerEvents: "none",
  });

  const prose = document.createElement("div");
  prose.className = "page-prose";
  scratch.appendChild(prose);
  scope.appendChild(scratch);

  const pages = [];
  let curHeader = headHtml;
  let curBlocks = [];

  // Render the current page's accumulated blocks into the scratch so the
  // next measurement is relative to everything already on the page.
  const renderScratch = () => {
    prose.innerHTML = curHeader;
    for (const b of curBlocks) prose.insertAdjacentHTML("beforeend", b.html);
  };

  try {
    const cs = getComputedStyle(scratch);
    const padBottom = parseFloat(cs.paddingBottom) || 0;
    // Tiny safety margin so a sub-pixel render variation doesn't push the
    // last line of a block below the page clip.
    const limitBottom = box.height - padBottom - 2;

    prose.innerHTML = curHeader;

    for (const block of norm) {
      prose.insertAdjacentHTML("beforeend", block.html);
      const last = prose.lastElementChild;
      const lastBottom =
        last.getBoundingClientRect().bottom -
        scratch.getBoundingClientRect().top;

      if (curBlocks.length === 0) {
        // Always keep at least one block on a page even if it overflows on
        // its own — better to clip a giant block than to drop it entirely.
        curBlocks.push(block);
      } else if (lastBottom > limitBottom) {
        // This block doesn't fit. Pull it back off the scratch first.
        prose.removeChild(last);

        // Peel any trailing header-like blocks off the current page so a
        // heading or bare label never dangles with its body on the next
        // leaf. They travel forward with this block.
        const carried = [];
        while (curBlocks.length > 0 && curBlocks[curBlocks.length - 1].keepWithNext) {
          carried.unshift(curBlocks.pop());
        }

        // Flush the current page if anything remains on it. If peeling
        // emptied it (page held only headers), skip the flush and keep the
        // current header so it leads the next page instead.
        if (curBlocks.length > 0) {
          pages.push({ headerHtml: curHeader, blocks: curBlocks.map((b) => b.html) });
          curHeader = "";
        }

        // Start the new page with the carried headers + this block.
        curBlocks = [...carried, block];
        renderScratch();
      } else {
        curBlocks.push(block);
      }
    }
    if (curBlocks.length) {
      pages.push({ headerHtml: curHeader, blocks: curBlocks.map((b) => b.html) });
    }
  } finally {
    scratch.remove();
  }

  return pages.length ? pages : [{ headerHtml: headHtml, blocks: norm.map((b) => b.html) }];
}

function measurePageBox() {
  return { width: PAGE_FLIP_PAGE_W, height: PAGE_FLIP_PAGE_H };
}

// ============================================================
// Render
// ============================================================

// Each leaf is structured as:
//   <div class="book-leaf">          ← Turn.js owns sizing of this element
//     <div class="flip-page">         ← logical 290×410 parchment, CSS-scaled
//       …actual page content…
//     </div>
//   </div>
function buildPageElements(pages) {
  return pages.map((page, idx) => {
    return makeLeaf("", `<div class="flip-page" data-density="soft">${renderPage(page, idx + 1)}</div>`);
  });
}

function makeLeaf(extraCls, innerHTML) {
  const outer = document.createElement("div");
  outer.className = `book-leaf ${extraCls || ""}`.trim();
  outer.innerHTML = innerHTML;
  return outer;
}

function renderBook(state) {
  const container = $("#book-flip");
  if (!container) return;

  if (!state.currentBookId) {
    if (state.turnInst) {
      const jq = getTurn();
      if (jq) {
        try { jq(container).turn("destroy"); } catch (e) { /* ignore */ }
      }
      state.turnInst = null;
    }
    container.classList.remove("theme-blue", "theme-red", "theme-green");
    container.removeAttribute("style");
    container.style.width = "";
    container.style.height = "";
    removeBookSelectButton();
    renderBookStack(container, state);
    state.pages = [];
    state.currentPage = 1;
    return;
  }

  container.classList.remove("book-stack-mode");
  const activeBook = state.booksById[state.currentBookId];
  container.classList.remove("theme-blue", "theme-red", "theme-green");
  if (activeBook?.theme) container.classList.add(`theme-${activeBook.theme}`);

  const pages = buildPagesForBook(activeBook);
  state.bookPages[state.currentBookId] = pages;
  state.pages = pages;

  const contentNodes = buildPageElements(pages);
  // Wrap content between front and back hard covers.
  const allNodes = [
    ...buildHardCoverPages("front", state),
    ...contentNodes,
    ...buildHardCoverPages("back", state),
  ];
  // Tag each leaf with --left / --right so the gutter shadows / margin
  // rules in styles.css can target them. In Turn.js display:'double' mode
  // page 1 sits on the right by itself, then even pages go on the left and
  // odd pages on the right.
  allNodes.forEach((node, idx) => {
    const sideClass = (idx + 1) % 2 === 0 ? "--left" : "--right";
    node.classList.add(sideClass);
    const inner = node.firstElementChild;
    if (inner) inner.classList.add(sideClass);
  });

  const jq = getTurn();
  if (jq) {
    hardResetBook(state, container, allNodes);
  } else {
    container.classList.add("no-flip-fallback");
    container.innerHTML = "";
    allNodes.forEach((n) => container.appendChild(n));
  }

  ensureBookSelectButton(state);

  // The first packer pass can run before web fonts (IM Fell English,
  // Cinzel, Caveat) have settled. With fallback metrics the line-box is a
  // hair shorter than the real rendered text, so the packer fits one
  // paragraph too many on a page and the last one gets clipped by the
  // page's `overflow: hidden`. Once `document.fonts.ready` resolves, re-pack
  // against the now-accurate metrics; if the page count or content per
  // page changed, rebuild the flipbook. See scheduleAccuratePackPass.
  scheduleAccuratePackPass(state);
}

// Re-run the page packer after web fonts have loaded and swap pages in if
// anything moved. Idempotent — guarded by `_packPending` so it only runs
// once per renderBook invocation. Works for any book that has prose pages.
function scheduleAccuratePackPass(state) {
  if (!state.currentBookId) return;
  if (state._packPending) return;
  state._packPending = true;

  const run = () => {
    state._packPending = false;
    if (!state.turnInst) return;
    if (!state.currentBookId) return;

    const book = state.booksById[state.currentBookId];
    if (!book) return;

    // Serialize the current and proposed page layouts to a comparable
    // string so we can short-circuit when nothing moved.
    const signature = (pages) =>
      (pages || [])
        .map((p) => `${p.kind}|${p.headerHtml || ""}|${(p.blocks || []).join("\u241E")}`)
        .join("\u241D");

    const before = signature(state.pages);
    const newPages = buildPagesForBook(book);
    const after = signature(newPages);
    if (before === after) return;

    // Page count or content moved — rebuild Turn.js from scratch.
    state.pages = newPages;
    state.bookPages[state.currentBookId] = newPages;
    const contentNodes = buildPageElements(newPages);
    const allNodes = [
      ...buildHardCoverPages("front", state),
      ...contentNodes,
      ...buildHardCoverPages("back", state),
    ];
    allNodes.forEach((node, idx) => {
      const sideClass = (idx + 1) % 2 === 0 ? "--left" : "--right";
      node.classList.add(sideClass);
      const inner = node.firstElementChild;
      if (inner) inner.classList.add(sideClass);
    });
    const container = document.getElementById("book-flip");
    if (container) hardResetBook(state, container, allNodes);
  };

  const fontsReady = (document.fonts && document.fonts.ready)
    ? document.fonts.ready
    : Promise.resolve();
  fontsReady.then(() => requestAnimationFrame(run));
}

// Hard covers — front and back of the leather-bound tome. Turn.js uses
// `class="hard"` to render these as rigid pages with a different flip
// animation. Two leaves per cover (outside face + inside paste-down) give
// a believable "open the book" feel: page 1 is the closed front cover, page
// 2 is the inside-front-cover paste-down, content starts at page 3, etc.
function buildHardCoverPages(which, state) {
  const make = (cls, html) => makeLeaf(`hard ${cls}`,
    `<div class="flip-page hard ${cls}">${html || ""}</div>`);

  if (which === "front") {
    const meta = state.booksById[state.currentBookId] || state.books[0] || {};
    const stats = (meta.coverStats || "").trim();
    const glyph = (meta.glyph || "").trim();
    return [
      make("cover-front-outer", `
        <div class="hard-cover-art">
          <div class="hard-cover-frame">
            ${glyph ? `<span class="hard-cover-glyph">${escape(glyph)}</span>` : ""}
            <h1 class="hard-cover-title">${escape(meta.title || "")}</h1>
            <p class="hard-cover-subtitle">${escape(meta.subtitle || "")}</p>
            ${stats ? `<span class="hard-cover-stats">${escape(stats)}</span>` : ""}
          </div>
        </div>
      `),
      make("cover-front-inner", `<div class="hard-cover-endpaper"></div>`),
    ];
  }
  return [
    make("cover-back-inner",  `<div class="hard-cover-endpaper"></div>`),
    make("cover-back-outer",  `<div class="hard-cover-art back"></div>`),
  ];
}

// Build the flipbook from scratch — destroy + reinit is the safest path
// when the structural content changes and is fast enough at this page count.
//
// Critically, Turn.js does its own coordinate math against
// getBoundingClientRect during a flip — if the flipbook (or any ancestor)
// has a CSS transform, Turn.js misreads the cursor position and pages
// over-rotate. So we render Turn.js at the actual fit pixel size (no
// transform) and use the inner .flip-page (logical 290×410, CSS-scaled) to
// keep text wrapping consistent with the off-screen packer.
function hardResetBook(state, container, pageNodes) {
  const jq = getTurn();
  if (!jq) return;

  if (state.turnInst) {
    try { jq(container).turn("destroy"); } catch (e) { /* ignore */ }
    state.turnInst = null;
  }

  container.innerHTML = "";
  pageNodes.forEach((n) => container.appendChild(n));

  const totalPages = pageNodes.length;
  const startPage = clamp(state.currentPage || 1, 1, totalPages);

  const dims = computeBookDims();
  setLeafScaleVar(dims.scale);

  state.turnInst = jq(container).turn({
    width: dims.spreadW,
    height: dims.pageH,
    autoCenter: true,
    display: "double",
    elevation: 50,
    gradients: true,
    duration: 700,
    page: startPage,
    when: {
      turning: (_e, page) => {
        state.currentPage = page;
        if (state.currentBookId) state.bookPageById[state.currentBookId] = page;
        updateBookSelectButtonVisibility(state);
      },
      turned: (_e, page) => {
        state.currentPage = page;
        if (state.currentBookId) state.bookPageById[state.currentBookId] = page;
        updateBookSelectButtonVisibility(state);
      },
    },
  });
}

// Compute spread / page pixel size that fits inside #book's inner width,
// plus the matching scale for the logical 290×410 inner pages.
//
// The spread is also clamped to the viewport's available height (with a
// little margin) so that on short windows the book never overflows the
// screen vertically — height is the binding constraint in landscape, width
// in portrait.
function computeBookDims() {
  const book = document.getElementById("book");
  if (!book) return { spreadW: PAGE_FLIP_SPREAD_W, pageH: PAGE_FLIP_PAGE_H, scale: 1 };
  const cs = getComputedStyle(book);
  const pl = parseFloat(cs.paddingLeft)  || 0;
  const pr = parseFloat(cs.paddingRight) || 0;
  const inner = Math.max(0, book.clientWidth - pl - pr);

  // How tall is the viewport? Reserve a bit for the workbench padding,
  // candle, and corner studs so the book never grazes the table frame.
  const vh = (typeof window !== "undefined" && window.innerHeight) || 800;
  const heightBudget = Math.max(280, vh - 120);
  const widthFromHeight = heightBudget * (PAGE_FLIP_SPREAD_W / PAGE_FLIP_PAGE_H);

  // No longer cap at the logical PAGE_FLIP_SPREAD_W — modern browsers
  // re-rasterize transformed text at the target pixel size, so up-scaling
  // is sharp. The page packer keeps measuring against the logical 290×410
  // box, then we apply CSS `transform: scale(--page-scale)` to grow it
  // visually to whatever fits the column.
  const spreadW = Math.max(120, Math.floor(Math.min(inner, widthFromHeight)));
  const pageH   = Math.round(spreadW * (PAGE_FLIP_PAGE_H / PAGE_FLIP_SPREAD_W));
  const scale   = spreadW / PAGE_FLIP_SPREAD_W;
  return { spreadW, pageH, scale };
}

// Push the current logical→pixel scale into a CSS var so the inner
// .flip-page (sized at the logical 290×410) renders at the right pixel size
// via transform: scale(var(--page-scale)).
function setLeafScaleVar(scale) {
  const book = document.getElementById("book");
  if (book) book.style.setProperty("--page-scale", String(scale));
}

// Resize the live Turn.js instance in place — no destroy/reinit, no flicker.
function resizeBook(state) {
  if (!state || !state.turnInst) return;
  const dims = computeBookDims();
  setLeafScaleVar(dims.scale);
  try {
    state.turnInst.turn("size", dims.spreadW, dims.pageH);
  } catch (e) { /* ignore — turn.js can throw mid-animation */ }
}

let bookScaleObserverBound = false;
function ensureBookFlipScaleObserver(state) {
  if (bookScaleObserverBound) return;
  const book = document.getElementById("book");
  if (!book) return;
  bookScaleObserverBound = true;
  setLeafScaleVar(computeBookDims().scale);
  // ResizeObserver fires when the #book box changes (column width grew,
  // workbench reflowed, etc.). Window-level `resize` covers the case where
  // only viewport height changes — in that scenario #book itself doesn't
  // resize, but our height-budgeted spread does, so we need to refit.
  const ro = new ResizeObserver(() => {
    requestAnimationFrame(() => resizeBook(state));
  });
  ro.observe(book);
  // Window resize covers both the open-book height refit *and* the
  // closed-stack mode where each book's offset is computed from the
  // viewport width — without this re-render, the three cover slabs would
  // stay glued to their original spread when the window grows or shrinks.
  window.addEventListener("resize", () => {
    requestAnimationFrame(() => {
      if (state.currentBookId) resizeBook(state);
      else renderBook(state);
    });
  });
}

function renderPage(page, folio) {
  if (!page || page.kind === "blank") {
    return `<div class="page-folio">~ ${folio} ~</div>`;
  }
  if (page.kind === "prose") return renderProsePage(page, folio);
  return `<div class="page-folio">~ ${folio} ~</div>`;
}

// Prose page renderer: glue the (optional) header back on, concatenate the
// section blocks, and stamp the folio.
function renderProsePage(page, folio) {
  const headerHtml = page.headerHtml || "";
  const blocksHtml = (page.blocks || []).join("");
  return `
    <div class="page-prose">${headerHtml}${blocksHtml}</div>
    <div class="page-folio">~ ${folio} ~</div>
  `;
}

// ============================================================
// Book stack (closed-book chooser)
// ============================================================

// The Book Select pill lives directly on <body> (not inside #book) so it
// can be `position: fixed` to the viewport's bottom-right regardless of the
// workbench's `overflow: hidden` or any ancestor transforms Turn.js applies
// during animation. Created once and reused; visibility is toggled by
// `updateBookSelectButtonVisibility`.
function ensureBookSelectButton(state) {
  let btn = document.getElementById("book-select-btn");
  if (!btn) {
    btn = document.createElement("button");
    btn.id = "book-select-btn";
    btn.type = "button";
    btn.className = "book-select-btn";
    btn.setAttribute("aria-label", "Return to book selection");
    btn.innerHTML = `<span aria-hidden="true">\u21a9</span> Book Select`;
    btn.addEventListener("click", () => closeCurrentBookToStack(state));
    document.body.appendChild(btn);
  }
  updateBookSelectButtonVisibility(state);
}

// Kept for clarity at call-sites; the button is intentionally NOT removed
// from the DOM anymore so it can simply fade in/out via its `is-visible`
// class. We just toggle visibility.
function removeBookSelectButton() {
  const btn = document.getElementById("book-select-btn");
  if (btn) btn.classList.remove("is-visible");
}

// The button is visible the entire time a book is open, on every page —
// the user can return to the bookshelf from any spread, not just from the
// front cover.
function updateBookSelectButtonVisibility(state) {
  const btn = document.getElementById("book-select-btn");
  if (!btn) return;
  btn.classList.toggle("is-visible", !!state.currentBookId);
}

function renderBookStack(container, state) {
  container.classList.add("book-stack-mode");
  container.innerHTML = `
    <div class="book-stack-shell" role="listbox" aria-label="Book selection">
      ${state.books.map((book, idx) => renderStackBook(book, idx, state.selectedBookIndex, state.books.length)).join("")}
    </div>
  `;
  container.querySelectorAll(".book-stack-item").forEach((el) => {
    const idx = Number(el.dataset.bookIndex);
    el.addEventListener("click", () => {
      if (state.selectedBookIndex === idx) {
        openSelectedBook(state);
        return;
      }
      state.selectedBookIndex = idx;
      renderBook(state);
    });
  });
}

function renderStackBook(book, index, selectedIndex, total) {
  const active = index === selectedIndex;
  // Spread the books across the shelf even if there are fewer or more than
  // the original three. Span scales with the viewport using the same
  // `clamp(240px, 26vw, 340px)` math that index.html applies to each
  // .book-stack-item, then multiplied by 0.95 for a slight overlap (that
  // "stacked on the table" feel). Wider viewport → wider books → wider
  // gaps; narrow viewport → tighter stack that still fits the shelf.
  const vw = (typeof window !== "undefined" && window.innerWidth) || 1200;
  const itemW = Math.max(240, Math.min(340, vw * 0.26));
  const span = Math.round(itemW * 0.95);
  const center = (total - 1) / 2;
  const offsetX = Math.round((index - center) * span);
  const tilts = [-8, 3, 9, -5, 6];
  const rotate = tilts[index % tilts.length];
  const offsetY = (index % 2 === 0) ? 8 : -4;
  const distance = Math.abs(index - selectedIndex);
  const zIndex = active ? 30 : 20 - distance * 5;
  const glyph = (book.glyph || "").trim();
  return `
    <button
      class="book-stack-item theme-${escape(book.theme || "green")} ${active ? "is-selected" : ""}"
      type="button"
      role="option"
      aria-selected="${active ? "true" : "false"}"
      data-book-index="${index}"
      style="--stack-rotate:${rotate}deg;--stack-offset-x:${offsetX}px;--stack-offset-y:${offsetY}px;--stack-layer:${index};--stack-z:${zIndex};"
    >
      <div class="hard-cover-art">
        <div class="hard-cover-frame">
          ${glyph ? `<span class="hard-cover-glyph">${escape(glyph)}</span>` : ""}
          <h1 class="hard-cover-title">${escape(book.title || "")}</h1>
          <p class="hard-cover-subtitle">${escape(book.subtitle || "")}</p>
        </div>
      </div>
    </button>
  `;
}

function shiftSelectedStackBook(state, delta) {
  const total = state.books.length;
  if (total === 0) return;
  state.selectedBookIndex = (state.selectedBookIndex + delta + total) % total;
}

function openSelectedBook(state) {
  const selected = state.books[state.selectedBookIndex];
  if (!selected) return;
  state.currentBookId = selected.id;
  // Always start on page 1 (the closed front cover) so the user sees the
  // book "in their hands" before opening it.
  state.currentPage = 1;
  state.bookPageById[selected.id] = 1;
  renderBook(state);
}

function closeCurrentBookToStack(state) {
  if (!state.currentBookId) return;
  // Reset the remembered page so the book is "closed" (front cover) the
  // next time it's selected from the stack.
  state.bookPageById[state.currentBookId] = 1;
  const idx = state.books.findIndex((b) => b.id === state.currentBookId);
  if (idx >= 0) state.selectedBookIndex = idx;
  state.currentBookId = null;
  renderBook(state);
}

// ============================================================
// Navigation
// ============================================================

function flipBook(state, dir) {
  if (!state.turnInst) return;
  try {
    if (dir > 0) state.turnInst.turn("next");
    else         state.turnInst.turn("previous");
  } catch (e) { /* turn.js can throw at boundaries; ignore */ }
}

// ============================================================
// helpers
// ============================================================

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function escape(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}
