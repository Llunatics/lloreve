/* lloreve — core logic (no DOM, no dependencies).
 * Works in Node (module.exports) and in the browser (window.lloreve).
 * Data model:
 *   title = {
 *     id, name, status: 'reading'|'completed'|'plan'|'dropped',
 *     rating: 0..5,
 *     units: { ln: 'vol'|'ch', manga: 'ch', anime: 'ep' },
 *     owned: { ln: [[1,4]], manga: [[1,48]], anime: [[1,12]] },
 *     total: { ln: 17, manga: 139, anime: 87 },   // 0 = unknown
 *     mappings: [ { ln:[1,2], manga:[1,12], anime:[1,4] }, ... ]
 *   }
 * A mapping row states that the three ranges cover the same story.
 * Ranges are inclusive, 1-based. A null range means "not adapted".
 */
"use strict";

const TRACKS = ["ln", "manga", "anime"];
const TRACK_LABEL = { ln: "Light Novel", manga: "Manga", anime: "Anime" };
const TRACK_UNIT = { ln: "vol", manga: "ch", anime: "ep" };
const STATUSES = ["reading", "completed", "plan", "dropped"];
const VERSION = "1.0.0";

/* ---------- ranges ---------- */

/** Parse "1-4, 7, 9-12" -> [[1,4],[7,7],[9,12]] (merged, sorted).
 *  Throws RangeError with a human-readable message on bad input. */
function parseRanges(input) {
  if (input === undefined || input === null) return [];
  const s = String(input).trim();
  if (s === "") return [];
  const out = [];
  for (const part of s.split(",")) {
    const p = part.trim();
    if (p === "") throw new RangeError(`empty range in "${s}"`);
    const m = /^(\d+)\s*(?:-\s*(\d+))?$/.exec(p);
    if (!m) throw new RangeError(`cannot parse range "${p}" (expected like 1-4 or 7)`);
    const a = Number(m[1]);
    const b = m[2] === undefined ? a : Number(m[2]);
    if (a < 1 || b < 1) throw new RangeError(`range "${p}" must start at 1 or above`);
    if (b < a) throw new RangeError(`range "${p}" is reversed (end before start)`);
    if (a > 100000 || b > 100000) throw new RangeError(`range "${p}" exceeds the 100000 cap`);
    out.push([a, b]);
  }
  return mergeRanges(out);
}

function mergeRanges(ranges) {
  const sorted = ranges
    .map(([a, b]) => [Math.min(a, b), Math.max(a, b)])
    .sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  const merged = [];
  for (const [a, b] of sorted) {
    const last = merged[merged.length - 1];
    if (last && a <= last[1] + 1) last[1] = Math.max(last[1], b);
    else merged.push([a, b]);
  }
  return merged;
}

function rangeTotal(ranges) {
  return ranges.reduce((n, [a, b]) => n + (b - a + 1), 0);
}

function rangeToString(ranges) {
  return ranges.map(([a, b]) => (a === b ? String(a) : `${a}-${b}`)).join(", ");
}

/** Intersection of two inclusive ranges, or null. */
function rangeIntersect([a1, b1], [a2, b2]) {
  const a = Math.max(a1, a2);
  const b = Math.min(b1, b2);
  return a <= b ? [a, b] : null;
}

/** Subtract `cut` from range [a,b]; returns 0-2 remaining ranges. */
function rangeSubtract([a, b], [c, d]) {
  const out = [];
  if (c > a) out.push([a, Math.min(b, c - 1)]);
  if (d < b) out.push([Math.max(a, d + 1), b]);
  return out.filter(([x, y]) => x <= y);
}

/* ---------- equivalence conversion ---------- */

/** Map an owned range on `fromTrack` through one mapping row into `toTrack`.
 *  The overlap fraction is applied proportionally, rounded to whole units. */
function mapRangeThroughRow(row, fromTrack, toTrack, [a, b]) {
  const from = row[fromTrack];
  const to = row[toTrack];
  if (!from || !to) return null;
  const overlap = rangeIntersect([a, b], from);
  if (!overlap) return null;
  const fromLen = from[1] - from[0] + 1;
  const toLen = to[1] - to[0] + 1;
  const start = to[0] + Math.round(((overlap[0] - from[0]) / fromLen) * toLen);
  const end = to[0] + Math.round(((overlap[1] - from[0] + 1) / fromLen) * toLen) - 1;
  const lo = Math.max(to[0], Math.min(start, to[1]));
  const hi = Math.max(to[0], Math.min(end, to[1]));
  return lo <= hi ? [lo, hi] : null;
}

/** Estimate which ranges of `toTrack` the owned ranges of `fromTrack`
 *  cover, using the title's mapping rows. Returns merged ranges. */
function equivalentCoverage(title, fromTrack, toTrack) {
  if (fromTrack === toTrack) return mergeRanges(title.owned[fromTrack] || []);
  const out = [];
  for (const owned of title.owned[fromTrack] || []) {
    for (const row of title.mappings || []) {
      const mapped = mapRangeThroughRow(row, fromTrack, toTrack, owned);
      if (mapped) out.push(mapped);
    }
  }
  return mergeRanges(out);
}

/** For one title: owned count, equivalent coverage, and % per track. */
function titleProgress(title) {
  const per = {};
  for (const t of TRACKS) {
    const owned = rangeTotal(title.owned[t] || []);
    const total = title.total[t] || 0;
    per[t] = {
      owned,
      total,
      pct: total > 0 ? Math.round((owned / total) * 100) : null,
    };
  }
  const equiv = {};
  for (const from of TRACKS) {
    for (const to of TRACKS) {
      if (from !== to) equiv[`${from}>${to}`] = equivalentCoverage(title, from, to);
    }
  }
  return { per, equiv };
}

/** Overall completion of a title: mean of the per-track % where a total
 *  is known and something is owned; null when nothing is measurable. */
function titleCompletion(title) {
  const pcts = TRACKS.map((t) => titleProgress(title).per[t].pct).filter(
    (p) => p !== null
  );
  if (pcts.length === 0) return null;
  return Math.round(pcts.reduce((s, p) => s + p, 0) / pcts.length);
}

/* ---------- collection stats & card ---------- */

function collectionStats(titles) {
  const stats = {
    titles: titles.length,
    byStatus: { reading: 0, completed: 0, plan: 0, dropped: 0 },
    owned: { ln: 0, manga: 0, anime: 0 },
    knownTotals: { ln: 0, manga: 0, anime: 0 },
    rated: 0,
    ratingSum: 0,
  };
  for (const t of titles) {
    if (STATUSES.includes(t.status)) stats.byStatus[t.status]++;
    for (const track of TRACKS) {
      stats.owned[track] += rangeTotal(t.owned[track] || []);
      stats.knownTotals[track] += t.total[track] || 0;
    }
    if (t.rating > 0) {
      stats.rated++;
      stats.ratingSum += t.rating;
    }
  }
  stats.avgRating =
    stats.rated > 0 ? Math.round((stats.ratingSum / stats.rated) * 10) / 10 : null;
  stats.completionPct = {};
  for (const track of TRACKS) {
    const tot = stats.knownTotals[track];
    stats.completionPct[track] =
      tot > 0 ? Math.round((stats.owned[track] / tot) * 100) : null;
  }
  return stats;
}

/** Top N titles by completion (ties: more owned units first, then name). */
function topTitles(titles, n = 5) {
  return [...titles]
    .map((t) => ({ title: t, completion: titleCompletion(t) }))
    .sort((a, b) => {
      const ca = a.completion === null ? -1 : a.completion;
      const cb = b.completion === null ? -1 : b.completion;
      if (cb !== ca) return cb - ca;
      const oa =
        rangeTotal(a.title.owned.ln) +
        rangeTotal(a.title.owned.manga) +
        rangeTotal(a.title.owned.anime);
      const ob =
        rangeTotal(b.title.owned.ln) +
        rangeTotal(b.title.owned.manga) +
        rangeTotal(b.title.owned.anime);
      if (ob !== oa) return ob - oa;
      return a.title.name.localeCompare(b.title.name);
    })
    .slice(0, n);
}

/* ---------- validation ---------- */

function validateTitle(t) {
  const errors = [];
  if (!t || typeof t !== "object") return ["title must be an object"];
  if (typeof t.name !== "string" || t.name.trim() === "")
    errors.push("name is required");
  if (t.name && t.name.length > 200) errors.push("name is too long (max 200)");
  if (!STATUSES.includes(t.status)) errors.push(`status must be one of ${STATUSES.join(", ")}`);
  if (typeof t.rating !== "number" || t.rating < 0 || t.rating > 5)
    errors.push("rating must be 0-5");
  for (const track of TRACKS) {
    const total = t.total[track];
    if (typeof total !== "number" || total < 0 || !Number.isInteger(total))
      errors.push(`total.${track} must be a non-negative integer`);
    for (const [a, b] of t.owned[track] || []) {
      if (a < 1 || b < a) errors.push(`owned.${track} has an invalid range ${a}-${b}`);
      if (total > 0 && b > total)
        errors.push(`owned.${track} ${a}-${b} exceeds total ${total}`);
    }
  }
  for (const row of t.mappings || []) {
    for (const track of TRACKS) {
      const r = row[track];
      if (r !== null && r !== undefined) {
        if (!Array.isArray(r) || r.length !== 2 || r[0] < 1 || r[1] < r[0])
          errors.push(`mapping has an invalid ${track} range`);
      }
    }
    if (TRACKS.every((track) => row[track] === null || row[track] === undefined))
      errors.push("mapping row is empty (all tracks null)");
  }
  return errors;
}

function newId() {
  return `t${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

function blankTitle() {
  return {
    id: newId(),
    name: "",
    status: "plan",
    rating: 0,
    units: { ln: "vol", manga: "ch", anime: "ep" },
    owned: { ln: [], manga: [], anime: [] },
    total: { ln: 0, manga: 0, anime: 0 },
    mappings: [],
  };
}

/* ---------- presets ----------
 * Equivalence rows are community estimates for well-known adaptations,
 * editable in the app. Sources: publisher volume counts + anime season
 * coverage as listed in the README. Treat them as starting points,
 * not canon. */

const PRESETS = [
  {
    id: "preset-aot",
    name: "Attack on Titan",
    status: "completed",
    rating: 5,
    units: { ln: "vol", manga: "ch", anime: "ep" },
    owned: { ln: [], manga: [[1, 139]], anime: [[1, 87]] },
    total: { ln: 0, manga: 139, anime: 87 },
    mappings: [
      { ln: null, manga: [1, 34], anime: [1, 25] },
      { ln: null, manga: [35, 51], anime: [26, 37] },
      { ln: null, manga: [51, 72], anime: [38, 49] },
      { ln: null, manga: [73, 90], anime: [50, 59] },
      { ln: null, manga: [91, 139], anime: [60, 87] },
    ],
  },
  {
    id: "preset-sololeveling",
    name: "Solo Leveling",
    status: "reading",
    rating: 5,
    units: { ln: "ch", manga: "ch", anime: "ep" },
    owned: { ln: [[1, 179]], manga: [[1, 179]], anime: [[1, 25]] },
    total: { ln: 179, manga: 179, anime: 25 },
    mappings: [
      { ln: [1, 45], manga: [1, 45], anime: [1, 12] },
      { ln: [46, 110], manga: [46, 110], anime: [13, 25] },
      { ln: [111, 179], manga: [111, 179], anime: null },
    ],
  },
  {
    id: "preset-konosuba",
    name: "KonoSuba",
    status: "reading",
    rating: 4,
    units: { ln: "vol", manga: "ch", anime: "ep" },
    owned: { ln: [[1, 3]], manga: [], anime: [[1, 20]] },
    total: { ln: 17, manga: 0, anime: 31 },
    mappings: [
      { ln: [1, 2], manga: null, anime: [1, 10] },
      { ln: [3, 4], manga: null, anime: [11, 20] },
      { ln: [5, 7], manga: null, anime: [21, 31] },
    ],
  },
];

const api = {
  VERSION,
  TRACKS,
  TRACK_LABEL,
  TRACK_UNIT,
  STATUSES,
  parseRanges,
  mergeRanges,
  rangeTotal,
  rangeToString,
  rangeIntersect,
  rangeSubtract,
  mapRangeThroughRow,
  equivalentCoverage,
  titleProgress,
  titleCompletion,
  collectionStats,
  topTitles,
  validateTitle,
  newId,
  blankTitle,
  PRESETS,
};

if (typeof module !== "undefined" && module.exports) module.exports = api;
if (typeof window !== "undefined") window.lloreve = api;
