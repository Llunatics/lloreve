/* Regression tests for lloreve core — node tests/run.js (no dependencies) */
"use strict";
const assert = require("assert");
const L = require("../lloreve.js");

let n = 0;
const ok = (cond, name) => {
  n++;
  assert(cond, "GAGAL: " + name);
  console.log("ok", n + ":", name);
};
const eq = (a, b, name) => ok(JSON.stringify(a) === JSON.stringify(b), `${name} (got ${JSON.stringify(a)})`);
const throws = (fn, name) => {
  n++;
  try {
    fn();
  } catch (e) {
    console.log("ok", n + ":", name);
    return;
  }
  assert(false, "GAGAL: " + name + " (no error thrown)");
};

/* 1. parseRanges */
eq(L.parseRanges("1-4, 7, 9-12"), [[1, 4], [7, 7], [9, 12]], "parse '1-4, 7, 9-12'");
eq(L.parseRanges(""), [], "parse empty string -> []");
eq(L.parseRanges("  3 "), [[3, 3]], "parse single with spaces");
eq(L.parseRanges("5-5"), [[5, 5]], "parse '5-5' -> [[5,5]]");
throws(() => L.parseRanges("abc"), "parse 'abc' throws");
throws(() => L.parseRanges("4-2"), "parse reversed '4-2' throws");
throws(() => L.parseRanges("0-3"), "parse '0-3' throws (1-based)");
throws(() => L.parseRanges("1,,3"), "parse '1,,3' throws on empty part");
throws(() => L.parseRanges("1-100001"), "parse over cap throws");

/* 2. mergeRanges: overlap + adjacency */
eq(L.mergeRanges([[1, 3], [3, 5], [8, 9], [7, 7]]), [[1, 5], [7, 9]], "merge overlap+adjacent");
eq(L.mergeRanges([[5, 6], [1, 2]]), [[1, 2], [5, 6]], "merge sorts");
eq(L.rangeTotal([[1, 4], [7, 7]]), 5, "rangeTotal 1-4 + 7 = 5");
eq(L.rangeToString([[1, 4], [7, 7], [9, 12]]), "1-4, 7, 9-12", "rangeToString");
eq(L.rangeIntersect([1, 10], [5, 15]), [5, 10], "intersect overlap");
eq(L.rangeIntersect([1, 4], [5, 9]), null, "intersect disjoint -> null");
eq(L.rangeSubtract([1, 10], [4, 6]), [[1, 3], [7, 10]], "subtract middle splits");
eq(L.rangeSubtract([1, 10], [1, 10]), [], "subtract whole -> []");
eq(L.rangeSubtract([1, 10], [20, 30]), [[1, 10]], "subtract disjoint -> unchanged");

/* 3. equivalence conversion — exact row */
{
  const t = L.PRESETS[0]; // Attack on Titan
  eq(L.equivalentCoverage(t, "manga", "anime"), [[1, 87]], "AoT manga 1-139 -> anime 1-87");
  eq(L.equivalentCoverage(t, "anime", "manga"), [[1, 139]], "AoT anime 1-87 -> manga 1-139");
}
{
  // partial ownership maps proportionally
  const t = JSON.parse(JSON.stringify(L.PRESETS[0]));
  t.owned = { ln: [], manga: [[1, 34]], anime: [] };
  eq(L.equivalentCoverage(t, "manga", "anime"), [[1, 25]], "AoT manga 1-34 -> anime 1-25");
  t.owned.manga = [[1, 17]];
  eq(L.equivalentCoverage(t, "manga", "anime"), [[1, 13]], "AoT manga 1-17 -> anime ~1-13 (rounded)");
  t.owned.manga = [[35, 51]];
  // ch 51 is shared: S2 finale (ep 37) and S3 premiere (ep 38) both cover it,
  // so [26,37] + [38,38] merge into one range
  eq(L.equivalentCoverage(t, "manga", "anime"), [[26, 38]], "AoT manga 35-51 -> anime 26-38 (ch 51 shared)");
}
{
  // owned range spanning two rows merges
  const t = JSON.parse(JSON.stringify(L.PRESETS[2])); // KonoSuba
  t.owned = { ln: [[1, 4]], manga: [], anime: [] };
  eq(L.equivalentCoverage(t, "ln", "anime"), [[1, 20]], "KonoSuba LN 1-4 -> anime 1-20");
  t.owned.ln = [[1, 2]];
  eq(L.equivalentCoverage(t, "ln", "anime"), [[1, 10]], "KonoSuba LN 1-2 -> anime 1-10");
  // no mapping row for the track -> empty
  eq(L.equivalentCoverage(t, "manga", "anime"), [], "KonoSuba manga (none owned) -> []");
  // unadapted tail: Solo Leveling novel 111-179 has no anime row
  const sl = JSON.parse(JSON.stringify(L.PRESETS[1]));
  sl.owned = { ln: [[111, 179]], manga: [], anime: [] };
  eq(L.equivalentCoverage(sl, "ln", "anime"), [], "Solo Leveling novel 111-179 -> no anime yet");
  eq(L.equivalentCoverage(sl, "ln", "manga"), [[111, 179]], "Solo Leveling novel 111-179 -> manhwa 111-179");
}

/* 4. titleProgress / titleCompletion */
{
  const t = L.PRESETS[0];
  const p = L.titleProgress(t);
  eq(p.per.manga, { owned: 139, total: 139, pct: 100 }, "AoT manga 100%");
  eq(p.per.anime, { owned: 87, total: 87, pct: 100 }, "AoT anime 100%");
  eq(p.per.ln, { owned: 0, total: 0, pct: null }, "AoT LN unknown total -> null pct");
  ok(L.titleCompletion(t) === 100, "AoT completion 100");
  const k = L.PRESETS[2];
  ok(L.titleCompletion(k) === 42, "KonoSuba completion = mean(18, 65) = 41.5 -> 42, got " + L.titleCompletion(k));
  const blank = L.blankTitle();
  ok(L.titleCompletion(blank) === null, "blank title completion null");
}

/* 5. collectionStats */
{
  const s = L.collectionStats(L.PRESETS);
  ok(s.titles === 3, "stats: 3 titles");
  eq(s.byStatus, { reading: 2, completed: 1, plan: 0, dropped: 0 }, "stats byStatus");
  eq(s.owned, { ln: 182, manga: 318, anime: 132 }, "stats owned totals");
  ok(s.avgRating === 4.7, "stats avgRating 4.7, got " + s.avgRating);
  eq(s.completionPct, { ln: 93, manga: 100, anime: 92 }, "stats completionPct (LN 182/196, anime 132/143)");
  const top = L.topTitles(L.PRESETS, 2).map((x) => x.title.name);
  // both 100%; Solo Leveling wins the tie-break (383 owned units vs 226)
  eq(top, ["Solo Leveling", "Attack on Titan"], "topTitles order");
}

/* 6. validateTitle */
{
  const bad = L.blankTitle();
  bad.name = "";
  ok(L.validateTitle(bad).includes("name is required"), "validate: empty name");
  const over = L.blankTitle();
  over.name = "x";
  over.total.ln = 3;
  over.owned.ln = [[1, 5]];
  ok(L.validateTitle(over).some((e) => e.includes("exceeds total")), "validate: owned exceeds total");
  const emptyRow = L.blankTitle();
  emptyRow.name = "x";
  emptyRow.mappings = [{ ln: null, manga: null, anime: null }];
  ok(L.validateTitle(emptyRow).some((e) => e.includes("empty")), "validate: empty mapping row");
  const good = JSON.parse(JSON.stringify(L.PRESETS[1]));
  eq(L.validateTitle(good), [], "validate: preset Solo Leveling is valid");
  for (const p of L.PRESETS) eq(L.validateTitle(p), [], `validate: preset ${p.name} is valid`);
}

/* 7. blankTitle defaults */
{
  const b = L.blankTitle();
  ok(b.status === "plan" && b.rating === 0, "blankTitle defaults");
  eq(b.owned, { ln: [], manga: [], anime: [] }, "blankTitle empty owned");
  eq(b.units, { ln: "vol", manga: "ch", anime: "ep" }, "blankTitle units");
}

/* 8. audit 2026-11-14: validation must never throw, ranges must be integers */
{
  // incomplete shapes -> error list, not a throw (a single bad stored title
  // used to nuke the whole collection via load()'s filter)
  ok(Array.isArray(L.validateTitle({})) && L.validateTitle({}).length > 0, "validate: {} returns errors, no throw");
  const noOwned = L.blankTitle(); delete noOwned.owned;
  ok(L.validateTitle(noOwned).some((e) => e.includes("owned")), "validate: missing owned -> error, no throw");
  const noTotal = L.blankTitle(); delete noTotal.total;
  ok(L.validateTitle(noTotal).some((e) => e.includes("total")), "validate: missing total -> error, no throw");
  const noUnits = L.blankTitle(); delete noUnits.units;
  ok(L.validateTitle(noUnits).some((e) => e.includes("units")), "validate: missing units -> error, no throw");
  const noId = L.blankTitle(); delete noId.id;
  ok(L.validateTitle(noId).some((e) => e.includes("id")), "validate: missing id -> error");
  // non-integer range endpoints are rejected (strings smuggled an XSS
  // payload through the mapping table; fractions/NaN broke rangeTotal)
  const strOwned = L.blankTitle(); strOwned.name = "x";
  strOwned.owned.ln = [["<img src=x onerror=alert(1)>", "zzz"]];
  ok(L.validateTitle(strOwned).some((e) => e.includes("non-integer")), "validate: string owned range rejected");
  const fracOwned = L.blankTitle(); fracOwned.name = "x";
  fracOwned.owned.ln = [[1.5, 4]];
  ok(L.validateTitle(fracOwned).some((e) => e.includes("non-integer")), "validate: fractional owned range rejected");
  const nanOwned = L.blankTitle(); nanOwned.name = "x";
  nanOwned.owned.ln = [[NaN, 4]];
  ok(L.validateTitle(nanOwned).some((e) => e.includes("non-integer")), "validate: NaN owned range rejected");
  const strMap = L.blankTitle(); strMap.name = "x";
  strMap.mappings = [{ ln: ["<img src=x onerror=alert(1)>", "zzz"], manga: null, anime: null }];
  ok(L.validateTitle(strMap).some((e) => e.includes("invalid ln")), "validate: string mapping range rejected");
  const nullRow = L.blankTitle(); nullRow.name = "x";
  nullRow.mappings = [null];
  ok(L.validateTitle(nullRow).some((e) => e.includes("mapping row")), "validate: null mapping row -> error, no throw");
  const strOwnedShape = L.blankTitle(); strOwnedShape.name = "x";
  strOwnedShape.owned.ln = "1-4";
  ok(L.validateTitle(strOwnedShape).some((e) => e.includes("must be an array")), "validate: owned as string rejected");
  // stats/progress/topTitles tolerate a title missing owned/total
  const bare = { name: "x", status: "plan", rating: 0 };
  ok(L.titleProgress(bare).per.ln.owned === 0, "titleProgress tolerates missing owned/total");
  ok(L.titleCompletion(bare) === null, "titleCompletion tolerates missing owned/total");
  ok(L.collectionStats([bare]).titles === 1, "collectionStats tolerates missing owned/total");
  ok(L.topTitles([bare], 5).length === 1, "topTitles tolerates missing owned/total");
}

/* 9. audit 2026-11-15: id uniqueness + truncated parse errors */
{
  // Date.now + 1296 random values per ms collided ~80k times per 200k
  // calls; a monotonic counter now guarantees uniqueness in a session.
  const ids = new Set();
  for (let i = 0; i < 100000; i++) ids.add(L.newId());
  ok(ids.size === 100000, "newId: 100k rapid calls are all unique");
  // error messages must not echo a giant pasted input verbatim
  try {
    L.parseRanges("x".repeat(5000));
    ok(false, "parse 5k-char junk throws");
  } catch (e) {
    ok(e.message.length < 200, `parse error truncates echoed input (got ${e.message.length} chars)`);
  }
  try {
    L.parseRanges("1,".repeat(2000) + "abc");
    ok(false, "parse trailing junk throws");
  } catch (e) {
    ok(e.message.length < 200, `parse error truncates long whole-input echo (got ${e.message.length} chars)`);
  }
}

console.log(`\n${n} assertions passed.`);
