# Reading accuracy on synthetic documents (cloud path)

Run on 27 Nov 2026 against https://hushmark.pages.dev in Cloud mode with `node tools/bench.mjs <url>`. One real call per document through the site's own upload flow (Firebase AI Logic, cloud Gemini chain).

**Set:** the 8 synthetic example documents (2 per desk) in 3 variants each = 24 images. Variants: `clean` (monospace receipt), `sans` (sans-serif font), `degraded` (rotated 2.5 degrees, blurred, noisy, 0.7 scale, JPEG quality 0.5). Ground truth comes from the generator, so it is exact.

**Scored fields:** provider, reference, party, date, total (within 0.01), category. Line items are not scored.

| Variant | Docs | provider | reference | party | date | total | category | all 6 fields right |
|---|---|---|---|---|---|---|---|---|
| clean | 8 | 8 | 8 | 7 | 8 | 8 | 8 | 7 |
| sans | 8 | 8 | 8 | 7 | 8 | 8 | 8 | 7 |
| degraded | 8 | 8 | 8 | 7 | 8 | 8 | 8 | 7 |
| **all** | **24** | **24** | **24** | **21** | **24** | **24** | **24** | **21 (87.5%)** |

All 24 were read by the cloud path (badge CLOUD). The 3 misses are the same field: the patient name on the two health documents was left empty (the prompt says to omit what is not visible); nothing was read wrongly. Missing names are caught by the `no-party` rule.

**Limits.** These documents are drawn by us from one template family, in English, USD, printed fonts. They are easier than real photos. This says nothing about handwriting, crumpled paper, other languages, other layouts or the on-device Gemini Nano path (not tested on real hardware). One run, no repeats. Raw results: `benchmark-results.json`.
