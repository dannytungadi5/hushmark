# Reading accuracy on synthetic documents (cloud path)

Run on 27 Nov 2026 against https://hushmark.pages.dev in Cloud mode with `node tools/bench.mjs <url>`. One real call per document through the site's own upload flow (Firebase AI Logic, cloud Gemini chain). Two runs: the first run (24 images) before a prompt fix for the party name, the second (40 images) after it.

**Set:** the 8 synthetic example documents (2 per desk) in 5 variants each = 40 images. Variants: `clean` (monospace receipt), `sans` (sans-serif font), `degraded` (rotated 2.5 degrees, blurred, noisy, 0.7 scale, JPEG quality 0.5), `tilt` (harder: rotated 7 degrees, blur 1.3px, strong noise, 0.55 scale, JPEG quality 0.4) and `indo` (Indonesian labels: NAMA, TANGGAL, NO. REF, PPN, sans-serif). Ground truth comes from the generator, so it is exact.

**Scored fields:** provider, reference, party, date, total (within 0.01), category. Line items are not scored.

| Variant | Docs | provider | reference | party | date | total | category | all 6 right |
|---|---|---|---|---|---|---|---|---|
| clean | 8 | 8 | 8 | 7 | 8 | 8 | 8 | 7 |
| sans | 8 | 8 | 8 | 8 | 8 | 8 | 8 | 8 |
| degraded | 8 | 8 | 8 | 7 | 8 | 8 | 8 | 7 |
| **first three** | **24** | **24** | **24** | **22** | **24** | **24** | **24** | **22 (91.7%)** |
| indo | 8 | 7 | 8 | 7 | 8 | 8 | 8 | 6 |
| tilt (hard) | 8 | 8 | 2 | 7 | 2 | 7 | 8 | 0 |

All 40 were read by the cloud path (badge CLOUD).

**What the numbers say, honestly.**
- First run (before the prompt fix): 21 of 24 right; the 3 misses were an empty party name on the health documents.
- After the prompt fix: 22 of 24. The two remaining misses are an empty party name (h-hospital degraded, t-clinic clean). Gemini sometimes still leaves it out.
- `indo`: 6 of 8. Misses: one provider read as the generic word "workshop", one empty party name.
- `tilt` is where it breaks, and some errors are WRONG values, not empty ones: reference numbers and dates were misread digit by digit on 6 of 8 images (for example year 2020 instead of 2026, INV-28410 instead of INV-20418), one total was wrong (21.07 instead of 21.67) and one party was invented ("Omit testart"). On this set no image was fully right. A handler must still look at the photo; this is why the product flags and a person decides.
- Because dates and digits can be wrong on poor photos, the rules (date before incident, arithmetic, missing fields) can raise false flags or miss real ones on such photos. We have not measured that.

**Limits.** The documents are drawn by us from one template family, in English or with Indonesian labels, USD, printed fonts. They are easier than real photos in most ways and harsher in one (the tilt set is deliberately bad). This says nothing about handwriting, crumpled paper, other layouts or the on-device Gemini Nano path (not tested on real hardware). One run per set, no repeats, so single-document differences between runs are within noise. Raw results: `benchmark-results.json`.
