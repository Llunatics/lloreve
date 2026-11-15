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

## Round 2 — Sunday 2026-11-15 (v1.0.1 → v1.0.2, final)

Saturday's verdict was already final, so this round is extra deepening:
fresh-copy full-suite re-run first (65/65 + 32/32 green at `365cf95`),
then a new 9-case adversarial/perf probe against v1.0.1. It found 4 real
bugs; one honest limit from Round 1 is now fixed too.

### P2 — `newId()` collided under rapid creation

`Date.now()` + 1296 random values per millisecond: 200k calls produced
~82k collisions. Two titles created in the same millisecond could share
an id, so edit would hit the first and delete would remove both. The UI
creates ids one at a time, so this was latent — but any bulk path would
have hit it immediately.

Fix: a monotonic per-session counter is now part of every id, so
uniqueness no longer depends on randomness. Probe after fix: 200k calls,
0 collisions.

### P2 — Duplicate ids smuggled in via localStorage

Round 1 fixed duplicate ids on *import*, but hand-edited storage could
still load two titles with one id — both rendered, delete removed both.
Fix: `load()` now dedupes by id (keeps the first occurrence), the same
guarantee as import, at the other entry point.

### P2 — `localStorage` quota failure: uncaught throw, stale UI, no feedback

The honest limit from Round 1, verified live: with a throwing store,
reset replaced the in-memory titles but `save()` threw before `render()`,
so the exception escaped the click handler, the user saw nothing, and
the list kept showing the old collection. (The add-title form caught it
by accident, but still showed a confusing error while the title was
already in memory.)

Fix: `save()` returns success/failure instead of throwing;
`saveAndRender()` alerts once ("Could not save to browser storage…")
and always re-renders, so the UI matches in-memory state and the change
survives for the session.

### P2 — Render recomputed `titleProgress` ~4x per card

Per card, `renderList` called `titleCompletion()` (1 full
`titleProgress`), `trackView()` called it 3x more, and `equivView()`
re-ran all 6 `equivalentCoverage()` calls even though `titleProgress`
already computes them. Measured on 500 heavy titles (3 mappings each):
boot 245ms, re-render 176ms, 1500 `titleProgress` calls per render.

Fix: one `titleProgress(t)` per card; `trackView`/`equivView` take the
cached result, and the completion badge is derived from the same
`prog.per` (formula identical to `titleCompletion`, guarded by a test
asserting the badges show 100% / 42% for the presets). After fix: boot
64ms, re-render 49ms, 500 calls per render (~3.5–3.8x faster). A
pathological title (2000 owned ranges × 100 mappings) still costs
~25ms per `titleProgress` call — bounded, and now paid once, not ~10x.

### P3 — Bidi/control characters in titles could spoof adjacent UI

A hostile shared title name containing U+202E (right-to-left override)
or C0 controls rendered raw into card HTML — `esc()` only handled
`&<>"'`. A crafted name could visually reorder neighbouring UI text.

Fix: `esc()` now strips C0/C1 controls, bidi isolates/overrides
(U+202A–U+202E, U+2066–U+2069), U+200E/U+200F and U+FEFF before
escaping. Visible text is unchanged; the strip is covered by a smoke
test.

### P3 — Parse errors echoed giant pasted input verbatim

`parseRanges()` put the whole input string into its `RangeError`
message — a 5k-char paste became a 5k-char error string shown in the
form. Fix: echoed input is truncated to 60 chars (+ "…").

### Verified safe (no change)

- Prototype pollution via import (`id: "__proto__"`, hostile `units`):
  no `Object.prototype` pollution, app keeps working, later titles load.
- `parseRanges` part-count blowup: 100k parts ~70–98ms, 200k duplicate
  parts ~80ms, 50k full-range parts ~25–40ms — no cap needed.
- Extreme totals: owned `[1, 100000]` renders `width:100%`; total
  `1e15` renders without `NaN`/`Infinity`.
- Version label drift (found while auditing): `VERSION` in
  `lloreve.js` still said `"1.0.0"` after Round 1 shipped v1.0.1.
  Bumped to `"1.0.2"` with this round.

### Tests

- `tests/run.js`: 65 → 68 assertions (+3: `newId` uniqueness over
  100k calls, parse-error truncation ×2).
- `tests/ui-smoke.js`: 32 → 44 assertions (+12: duplicate-id storage
  dedupe, quota-failure alert + re-render, bidi/control strip,
  completion badges 100%/42%, `titleProgress` call count ≤ 22 per
  20-card render).
- Fresh-clone re-run after push: both suites green.

### Verdict — FINAL

**v1.0.2 solid.** No P1/P2 findings remain open across both rounds.
Honest limits: equivalence rows are editable estimates, not canon; the
PNG card truncates very long titles visually; a pathological title
(2000 owned ranges × 100 mappings) costs ~25ms per render; quota-full
saves now warn and keep changes for the session only (data is not
persisted until storage frees up).
