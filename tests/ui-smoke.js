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

const elements = {};
const documentStub = {
  getElementById: (id) => (elements[id] ??= new El(id)),
  createElement: (tag) => new El(tag),
  addEventListener: () => {},
};
const store = {};
const sandbox = {
  console,
  window: {},
  document: documentStub,
  localStorage: {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
  },
  structuredClone,
  confirm: () => true,
  alert: () => {},
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync("lloreve.js", "utf8"), sandbox, { filename: "lloreve.js" });
vm.runInContext(fs.readFileSync("app.js", "utf8"), sandbox, { filename: "app.js" });

let n = 0;
const ok = (cond, name) => {
  n++;
  assert(cond, "GAGAL: " + name);
  console.log("ok", n + ":", name);
};

// initial render ran at load: presets seeded, stats + list populated
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

console.log(`\n${n} UI smoke assertions passed.`);
