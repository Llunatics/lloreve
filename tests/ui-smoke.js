/* UI smoke test — runs app.js against a minimal DOM shim in Node.
 * Catches runtime errors in the render path (stats, list, equivalence
 * readout, dialog open) without a real browser. Run: node tests/ui-smoke.js */
"use strict";
const assert = require("assert");
const fs = require("fs");
const vm = require("vm");

class El {
  constructor(id) {
    this.id = id || "";
    this.children = [];
    this._html = "";
    this.hidden = false;
    this.value = "";
    this.textContent = "";
    this.className = "";
    this.listeners = {};
    this.dataset = {};
    this.files = [];
  }
  set innerHTML(v) { this._html = String(v); this.children = []; }
  get innerHTML() { return this._html; }
  addEventListener(t, fn) { (this.listeners[t] ??= []).push(fn); }
  appendChild(c) { this.children.push(c); return c; }
  querySelector() { return new El(); }
  querySelectorAll(sel) {
    return sel === ".map-row" ? this.children.filter((c) => c.className === "map-row") : [];
  }
  focus() {}
  click() {}
  remove() {}
}

function boot(storeData, opts = {}) {
  const elements = {};
  const store = {};
  if (storeData !== undefined) store["lloreve.v1"] = storeData;
  const alerts = [];
  const sandbox = {
    console,
    window: {},
    document: {
      getElementById: (id) => (elements[id] ??= new El(id)),
      createElement: (tag) => new El(tag),
      addEventListener: () => {},
    },
    localStorage: opts.quotaThrow
      ? {
          getItem: (k) => (k in store ? store[k] : null),
          setItem: () => { const e = new Error("QuotaExceededError"); e.name = "QuotaExceededError"; throw e; },
        }
      : {
          getItem: (k) => (k in store ? store[k] : null),
          setItem: (k, v) => { store[k] = String(v); },
        },
    structuredClone,
    confirm: () => true,
    alert: (msg) => { alerts.push(String(msg)); },
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync("lloreve.js", "utf8"), sandbox, { filename: "lloreve.js" });
  let progressCalls = 0;
  if (opts.countProgress) {
    const orig = sandbox.window.lloreve.titleProgress;
    sandbox.window.lloreve.titleProgress = (...a) => { progressCalls++; return orig(...a); };
  }
  vm.runInContext(fs.readFileSync("app.js", "utf8"), sandbox, { filename: "app.js" });
  return { elements, store, alerts, sandbox, get progressCalls() { return progressCalls; } };
}

let n = 0;
const ok = (cond, name) => {
  n++;
  assert(cond, "GAGAL: " + name);
  console.log("ok", n + ":", name);
};

// initial render ran at load: presets seeded, stats + list populated
const { elements, store } = boot();
const statsHtml = elements.stats.innerHTML;
ok(statsHtml.includes(">3 <"), "stats show 3 titles, got: " + statsHtml.slice(0, 120));
ok(statsHtml.includes("182"), "stats show 182 LN vol owned");
ok(statsHtml.includes("318"), "stats show 318 manga ch owned");
ok(statsHtml.includes("132"), "stats show 132 anime ep owned");
const listHtml = elements.list.innerHTML;
for (const name of ["Attack on Titan", "Solo Leveling", "KonoSuba"]) {
  ok(listHtml.includes(name), `list renders ${name}`);
}
ok(listHtml.includes("covers"), "equivalence readout rendered");
ok(listHtml.includes("1-87"), "AoT equivalence anime 1-87 shown");
ok(listHtml.includes("★★★★★"), "5-star rating rendered");
ok(listHtml.includes("map-table"), "mapping table rendered");

// open the add dialog via the stored click handler
const addBtn = elements["btn-add"];
ok(addBtn.listeners.click && addBtn.listeners.click.length === 1, "add button has click handler");
addBtn.listeners.click[0]();
ok(elements["dialog-backdrop"].hidden === false, "dialog opens on + Add title");
ok(elements["dialog-title"].textContent === "Add title", "dialog title is 'Add title'");
ok(elements["mapping-rows"].children.length === 1, "dialog starts with one empty mapping row");
ok(elements["f-name"].value === "", "new-title form starts blank");

// filter: search "kono" narrows the list
elements.search.value = "kono";
elements.search.listeners.input[0]();
ok(elements.list.innerHTML.includes("KonoSuba"), "search 'kono' keeps KonoSuba");
ok(!elements.list.innerHTML.includes("Attack on Titan"), "search 'kono' hides Attack on Titan");
elements.search.value = "";
elements.search.listeners.input[0]();
ok(elements.list.innerHTML.includes("Attack on Titan"), "clearing search restores list");

// localStorage is written on first mutation, not on load — exercise reset
const resetBtn = elements["btn-reset"];
ok(resetBtn.listeners.click && resetBtn.listeners.click.length === 1, "reset button has click handler");
resetBtn.listeners.click[0]();
ok(JSON.parse(store["lloreve.v1"]).length === 3, "reset persists 3 presets to localStorage");

/* ---- audit 2026-11-14: adversarial render/storage cases ---- */
const L = require("../lloreve.js");
{
  // hostile units must be escaped, never rendered as live HTML (stored XSS)
  const evil = L.blankTitle();
  evil.name = "Evil"; evil.status = "reading"; evil.rating = 5;
  evil.units = { ln: "<img src=x onerror=alert(1)>", manga: "ch", anime: "ep" };
  evil.owned = { ln: [[1, 2]], manga: [], anime: [] };
  evil.total = { ln: 5, manga: 0, anime: 0 };
  evil.mappings = [{ ln: [1, 2], manga: null, anime: null }];
  const r = boot(JSON.stringify([evil, ...L.PRESETS]));
  ok(!r.elements.list.innerHTML.includes("<img src=x onerror=alert(1)>"), "hostile units.ln is escaped in track view");
  ok(r.elements.list.innerHTML.includes("&lt;img"), "hostile units.ln appears escaped, not raw");
}
{
  // hostile mapping range strings must not reach the table as live HTML
  const evil = L.blankTitle();
  evil.name = "Evil2"; evil.status = "reading";
  evil.mappings = [{ ln: ["<img src=x onerror=alert(1)>", "zzz"], manga: null, anime: null }];
  const r = boot(JSON.stringify([evil]));
  ok(!r.elements.list.innerHTML.includes("<img src=x onerror=alert(1)>"), "hostile mapping range is not rendered raw");
}
{
  // one corrupt stored title must not discard the valid ones
  const good = L.blankTitle(); good.name = "My Unique Title ZZZ"; good.status = "reading";
  const bad = { name: "Broken" };
  const r = boot(JSON.stringify([good, bad]));
  ok(r.elements.list.innerHTML.includes("My Unique Title ZZZ"), "valid title survives a corrupt stored sibling");
  ok(!r.elements.list.innerHTML.includes("Solo Leveling"), "presets are NOT force-loaded over valid stored data");
}
{
  // fractional rating still renders exactly 5 star glyphs
  const t = L.blankTitle(); t.name = "Half Star"; t.status = "reading"; t.rating = 3.5;
  const r = boot(JSON.stringify([t]));
  ok(r.elements.list.innerHTML.includes("★★★★☆"), "rating 3.5 renders ★★★★☆ (5 glyphs)");
}

/* ---- audit 2026-11-15: storage dedupe, quota failure, bidi strip, render cache ---- */
{
  // duplicate ids smuggled via hand-edited localStorage: only the first
  // survives load, so edit/delete by id can no longer hit two titles
  const a = L.blankTitle(); a.name = "Dup Stored A"; a.status = "reading";
  const b = L.blankTitle(); b.name = "Dup Stored B"; b.status = "reading"; b.id = a.id;
  const r = boot(JSON.stringify([a, b]));
  ok(r.elements.list.innerHTML.includes("Dup Stored A"), "duplicate stored id: first title renders");
  ok(!r.elements.list.innerHTML.includes("Dup Stored B"), "duplicate stored id: second title is dropped on load");
}
{
  // localStorage quota failure: the action must not throw uncaught, the
  // user must be told, and the UI must still re-render to match memory
  // (boot from a custom title so a stale list would be visible)
  const custom = L.blankTitle(); custom.name = "Custom Before Reset"; custom.status = "reading";
  const r = boot(JSON.stringify([custom]), { quotaThrow: true });
  ok(r.elements.list.innerHTML.includes("Custom Before Reset"), "quota setup: custom title renders before reset");
  let threw = null;
  try {
    r.elements["btn-reset"].listeners.click[0]();
  } catch (e) { threw = e; }
  ok(threw === null, "quota failure: reset does not throw uncaught");
  ok(r.alerts.length === 1 && r.alerts[0].includes("Could not save"), "quota failure: user is alerted, got: " + r.alerts.join("; "));
  ok(!r.elements.list.innerHTML.includes("Custom Before Reset"), "quota failure: stale custom title is gone after reset");
  ok(r.elements.list.innerHTML.includes("Attack on Titan"), "quota failure: list re-renders to the new in-memory state");
}
{
  // bidi-override / control chars in a hostile title name are stripped
  // before render, so they cannot reorder adjacent UI text
  const t = L.blankTitle();
  t.name = "Normal\u202E hacked — Delete\u0007"; t.status = "reading";
  const r = boot(JSON.stringify([t]));
  const html = r.elements.list.innerHTML;
  ok(!html.includes("\u202E") && !html.includes("\u0007"), "bidi/control chars are stripped from rendered titles");
  ok(html.includes("Normal hacked"), "stripped title still renders its visible text");
}
{
  // card completion badge matches titleCompletion (guards the inline
  // derivation from the cached titleProgress in renderList)
  const r = boot();
  ok(r.elements.list.innerHTML.includes("· 100%"), "AoT/Solo Leveling badge shows 100%");
  ok(r.elements.list.innerHTML.includes("· 42%"), "KonoSuba badge shows 42% (= titleCompletion)");
}
{
  // render cache: one titleProgress per card, not 3x trackView +
  // titleCompletion + 6x equivalentCoverage
  const mk = (i) => {
    const t = L.blankTitle();
    t.name = `Title ${i}`; t.status = "reading"; t.rating = 4;
    t.owned = { ln: [[1, 50]], manga: [[1, 200]], anime: [[1, 50]] };
    t.total = { ln: 100, manga: 300, anime: 60 };
    t.mappings = [
      { ln: [1, 25], manga: [1, 100], anime: [1, 25] },
      { ln: [26, 50], manga: [101, 200], anime: [26, 50] },
    ];
    return t;
  };
  const data = Array.from({ length: 20 }, (_, i) => mk(i));
  const r = boot(JSON.stringify(data), { countProgress: true });
  ok(r.progressCalls <= 22, `render of 20 cards calls titleProgress ${r.progressCalls}x (was 60x before caching)`);
}

/* ---- async: import handler ---- */
(async () => {
  const tick = () => new Promise((res) => setImmediate(res));
  const fileOf = (obj) => ({ text: async () => JSON.stringify(obj) });
  {
    // duplicate ids in an import file are rejected, collection untouched
    const a = L.blankTitle(); a.name = "Dup A"; a.status = "reading";
    const b = L.blankTitle(); b.name = "Dup B"; b.status = "reading"; b.id = a.id;
    const r = boot();
    const input = r.elements["file-import"];
    input.files = [fileOf([a, b])];
    input.listeners.change[0]({ target: input });
    await tick(); await tick();
    ok(r.alerts.length === 1 && r.alerts[0].includes("duplicate"), "import with duplicate ids alerts, got: " + r.alerts.join("; "));
    ok(r.elements.list.innerHTML.includes("Attack on Titan"), "duplicate-id import leaves collection untouched");
  }
  {
    // a valid import replaces the collection
    const t = L.blankTitle(); t.name = "Imported One"; t.status = "completed"; t.rating = 4;
    const r = boot();
    const input = r.elements["file-import"];
    input.files = [fileOf([t])];
    input.listeners.change[0]({ target: input });
    await tick(); await tick();
    ok(r.alerts.length === 0, "valid import raises no alert");
    ok(r.elements.list.innerHTML.includes("Imported One"), "valid import replaces the list");
    ok(!r.elements.list.innerHTML.includes("Attack on Titan"), "valid import drops the old titles");
  }
  console.log(`\n${n} UI smoke assertions passed.`);
})();
