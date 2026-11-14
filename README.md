# lloreve

Cross-media collection tracker for light novels, manga, and anime — **100% client-side**, no build step, no server, no account.

One story often lives in three media. lloreve tracks what you own in each medium and maps **adaptation equivalence**: a light-novel volume range, the manga chapters that cover the same story, and the anime episodes that cover it. Own LN vol. 1–4 and the app tells you which manga chapters and anime episodes that already covers.

## Features

- **Per-title tracking**: owned ranges + known totals for light novel, manga, and anime, per title
- **Adaptation equivalence**: editable mapping rows (`LN 1–2 = manga 1–12 = anime 1–4`); owned ranges convert proportionally across media
- **Collection dashboard**: totals owned per medium, completion % against known totals, average rating, status counts
- **Search, filter, sort**: by name, status, completion, rating
- **Collection card**: downloadable 1200×630 PNG summary (top 5 titles by completion) for a GitHub profile README
- **Import / export**: full collection as JSON; starter presets included, restorable any time
- **Local-first**: data lives in `localStorage`; nothing leaves the browser

## Usage

Open `index.html` in a browser — no installation required.

```bash
# or serve locally
python3 -m http.server 8000
# open http://localhost:8000
```

| Action | How |
| --- | --- |
| Add a title | **+ Add title**, fill owned ranges (`1-4, 7`) and totals (0 = unknown) |
| Map an adaptation | In the editor, add equivalence rows; leave a cell empty when a medium has no equivalent |
| See cross-media coverage | Each card shows e.g. *Own LN 1–3 → covers anime ep 1–20* |
| Share your collection | **Download card** exports a PNG; **Export JSON** backs up the data |

### Range syntax

| Input | Meaning |
| --- | --- |
| `1-4` | Units 1 through 4 |
| `7` | Unit 7 only |
| `1-4, 7, 9-12` | Multiple ranges (merged and sorted automatically) |

## Equivalence model

A mapping row states that its three ranges cover the same story. Conversion is proportional: owning half of a row's LN range maps to roughly half of that row's manga/anime ranges, rounded to whole units. Rows may overlap — a chapter adapted by two season finales maps to both episodes. Rows are estimates; edit them to match the edition you own.

Starter presets (editable, deletable):

| Title | Mapping basis |
| --- | --- |
| Attack on Titan | Manga ch. 1–139 ↔ anime ep. 1–87, by season |
| Solo Leveling | Novel/manhwa ch. 1–179 ↔ anime ep. 1–25; ch. 111–179 unadapted |
| KonoSuba | LN vol. 1–7 ↔ anime ep. 1–31 (seasons 1–3) |

## Files

| File | Purpose |
| --- | --- |
| `index.html` | App shell |
| `styles.css` | Near-black UI, single lime accent |
| `app.js` | DOM, editor dialog, card renderer, import/export |
| `lloreve.js` | Dependency-free core: ranges, equivalence math, stats, validation, presets |
| `tests/run.js` | Core-logic tests (`node tests/run.js`) |
| `tests/ui-smoke.js` | Render-path smoke test against a minimal DOM shim (`node tests/ui-smoke.js`) |

## Tests

```bash
node tests/run.js       # 65 assertions: ranges, conversion, stats, validation
node tests/ui-smoke.js  # 32 assertions: stats, list, search, dialog, reset, adversarial import/storage
```

## Data model

```json
{
  "id": "preset-aot",
  "name": "Attack on Titan",
  "status": "completed",
  "rating": 5,
  "units": { "ln": "vol", "manga": "ch", "anime": "ep" },
  "owned": { "ln": [], "manga": [[1, 139]], "anime": [[1, 87]] },
  "total": { "ln": 0, "manga": 139, "anime": 87 },
  "mappings": [{ "ln": null, "manga": [1, 34], "anime": [1, 25] }]
}
```

- `status`: `reading` | `completed` | `plan` | `dropped`
- `rating`: `0`–`5` (`0` = unrated)
- `total: 0` means unknown / ongoing; completion % is omitted for that track
- `units.ln` is `vol` or `ch` (web novels are chapter-based)

## Limitations

- Equivalence rows are manual estimates, not a scraped database — verify season/chapter boundaries for your edition.
- Proportional conversion rounds to whole units; boundary episodes may be off by one.
- Storage is per-browser `localStorage`; use Export JSON before clearing site data.

## License

MIT — see [LICENSE](LICENSE).
