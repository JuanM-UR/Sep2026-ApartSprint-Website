# Where AI-agent incidents go unreported

As part of a 3-day Apart AI incident response sprint, our group found that existing regulatory systems aren’t suitable to report real incidents caused by AI agents, like the Hugging Face attack or the DSEwiki incident.

This repo holds the code for a complementary website that visually aggregates the evidence that we collected. For more information, please refer to the paper at *placeholder*

## Running it locally

Since the site loads `data.json` and the locale files with `fetch`, it must be served:

```
uv run python -m http.server 8000
# open http://localhost:8000
```

Online distribution works through GitHub Pages.

## Structure Details (AI Written)

| File | Role |
|---|---|
| `data.json` | the only source of content: axes, instruments, cases, featured, hypothetical |
| `locales/en.json`, `locales/es.json` | all human-readable strings |
| `app.js` | the coverage engine + renderers (no dependencies) |
| `styles.css`, `index.html` | presentation |
| `tools/validate.py` | dev check: validates `data.json`, prints the computed matrix |

`data.json` is language-neutral; all prose lives in the locale bundles.

## Editing (AI Written)

`data.json` is the whole model. An **instrument** carries three condition gates
(`filer`, `threshold`, `visibility`) plus two descriptive facts (`legalBasis`,
`authority`); a gate is instrument-fixed (`failure` or `pass`) or case-scoped (reads
the case's verdict). A **case** carries evidence effects, public sources, and
per-instrument verdicts. The grid, the featured cards, and the hypothetical cards are
all computed from these by `app.js`.

After editing, run:

```
uv run python tools/validate.py            # or: ... --trace <case> <instrument>
```

`app.js` and `styles.css` carry no version query; if a change does not appear, do a
hard refresh.

## Licence

Split by content type:

- **Code** — `index.html`, `app.js`, `styles.css`, and `tools/` — under the **MIT
  License** (<https://opensource.org/license/mit>).
- **Content and data** — `data.json`, `locales/`, and this README — under **Creative
  Commons Attribution 4.0 International (CC BY 4.0)**
  (<https://creativecommons.org/licenses/by/4.0/>): reuse freely, with attribution.

When the public repository is created, commit the two texts as `LICENSE` (MIT) and
`LICENSE-CONTENT` (CC BY 4.0).
