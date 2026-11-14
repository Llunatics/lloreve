# lloreve — audit log

Staged audit, same bar as llumen / llogic-yara: functional round + adversarial
round, real-click / real-render checks, fresh-copy full-suite re-run.

## Round 1 — Saturday 2026-11-14 (v1.0.0 → v1.0.1)

Baseline before fixes: `node tests/run.js` 50/50, `node tests/ui-smoke.js` 21/21.
Adversarial probing (25-case probe + storage/XSS harness) found 5 real bugs.

### P1 — Stored XSS via imported JSON (two sinks)

A malicious shared collection `.json` executed script on import:

1. `units` values were interpolated unescaped in `app.js` `trackView()` and
   `equivView()` (`${unit}`, `${t.units[to]}`, `${t.units[from]}`).
   `units.ln = "<img src=x onerror=alert(1)>"` rendered as live HTML.
2. Mapping/owned range endpoints were never checked to be integers, so
   string payloads passed `validateTitle()` and `mapTable()` rendered
   `${r[0]}` / `${r[1]}` unescaped — same stored XSS.

Fix (defense in depth, both layers):
- `validateTitle()` now requires integer finite endpoints for every owned
  and mapping range; non-array `owned`/`mappings`, `null` mapping rows,
  missing `id`/`units` are errors.
- `app.js` escapes `units` in `trackView()` / `equivView()` and escapes
  mapping-table cell values.

### P1 — One corrupt stored title discarded the whole collection

`load()` filtered with `L.validateTitle(t).length === 0`, but
`validateTitle()` **threw** on titles missing `owned`/`total`. The throw
was caught by the outer `try/catch`, which silently returned the starter
presets — one malformed entry wiped the user's entire collection from view
(and the next save would overwrite storage with presets). Verified live:
a valid uniquely-named title next to `{name: "Broken"}` disappeared and
presets were force-loaded.

Fix:
- `validateTitle()` never throws: missing/non-object `owned`, `total`,
  `units`, `mappings` are error strings, not `TypeError`s.
- `load()` filters per title with its own `try/catch`, keeping every valid
  title; falls back to presets only when nothing valid remains. A
  deliberately emptied collection (`[]`) stays empty instead of
  resurrecting the presets.

### P2 — Non-integer ranges broke stats silently

Fractional (`1.5`), `NaN`, and string range endpoints passed validation;
`rangeTotal()` then returned `NaN` and stats/conversions degraded without
any error. Fixed by the integer-endpoint checks above, plus a finite-number
check on `rating`.

### P2 — Stats/progress/topTitles threw on titles missing `owned`/`total`

`titleProgress()`, `equivalentCoverage()`, `collectionStats()`,
`topTitles()` dereferenced `t.owned[track]` / `t.total[track]` directly.
Now all use `(t.owned || {})[track] || []` / `(t.total || {})[track] || 0`
and tolerate hand-built or legacy titles.

### P3 — Rating 3.5 rendered 4 star glyphs

`"★".repeat(3.5)` → 3 stars, `"☆".repeat(1.5)` → 1 star. The editor now
rounds the rating to an integer on save, and the card renderer rounds
imported fractional ratings, so 3.5 always shows `★★★★☆` (5 glyphs).

### Hardening — duplicate ids on import

Two titles sharing one `id` made edit hit the first and delete remove
both. Import now rejects files with duplicate ids.

### Verified safe (no change)

- `name` / `status` / `id` escaping in the card renderer (hostile values
  escaped or rejected by validation).
- `parseRanges` edges: trailing comma, `1.5`, `1e3`, `0`, reversed,
  over-cap `100001` all throw; `1 - 4` and cap boundary `100000` parse.
- Conversion math edges: single last unit maps to last episode, 2:1
  compression to a single episode, unadapted tails map to `[]`.
- `titleCompletion` mean includes tracks with a known total but 0 owned
  (0% counts) — matches the existing test expectation; left as-is.

### Tests

- `tests/run.js`: 50 → 65 assertions (+15: defensive validation,
  non-integer ranges, tolerance of missing `owned`/`total`).
- `tests/ui-smoke.js`: 21 → 32 assertions (+11: hostile units/mapping
  escaping, corrupt-sibling storage survival, 3.5-star render, duplicate-id
  import rejection, valid import replacement).
- Fresh-clone re-run after push: both suites green (see commit message).

### Verdict

**v1.0.1 solid.** The two P1s (stored XSS via import, single corrupt title
wiping the collection) are fixed with regression tests. No P1/P2 findings
remain open. Honest limits, unchanged from v1.0.0: equivalence rows are
editable estimates, not canon; the PNG card truncates very long titles
visually; `localStorage` quota errors surface uncaught on save.
