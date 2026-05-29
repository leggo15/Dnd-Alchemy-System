// Entry point. Loads data/pages.json and hands it off to the book UI.
// Resolves the JSON path relative to this module so the site works whether
// it's hosted at the site root or under a subpath.

import { initUI } from "./ui.js";

const DATA_URL = new URL("../data/pages.json", import.meta.url);

(async function main() {
  try {
    const res = await fetch(DATA_URL, { cache: "no-cache" });
    if (!res.ok) throw new Error(`Failed to load pages.json (${res.status})`);
    const data = await res.json();
    await initUI(data);
    window.__books = { data };
  } catch (err) {
    console.error(err);
    document.body.innerHTML = `
      <div style="padding:32px;color:#ef6f7a;font-family:system-ui;max-width:680px;margin:48px auto;">
        <h2>Failed to load the books.</h2>
        <p>${err.message}</p>
        <p>If you're opening <code>index.html</code> directly via <code>file://</code>, most browsers
        block <code>fetch()</code> on the local filesystem. Run a tiny static server instead:</p>
        <pre>python -m http.server 8080</pre>
        <p>then open <a href="http://localhost:8080">http://localhost:8080</a>.</p>
      </div>`;
  }
})();
