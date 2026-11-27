# Hushmark

Private pre-check for insurance claim documents (health, motor, travel, office expenses). Built for #BuildHybridAI 2026 (Web / Chrome).

Hushmark reads a claim document photo (clinic invoice, workshop repair bill, hotel or medical receipt abroad) through **Firebase AI Logic hybrid inference**: Gemini Nano on the device when Chrome has it, Gemini in the cloud otherwise (Private mode never uses the cloud). Then it runs plain-code rules for the chosen claim type and exports the findings as CSV. It flags problems for a claims handler. It does not detect fraud and never decides a claim.

## Why

Claims arrive as photos and PDFs. Handlers lose time on avoidable problems: a missing patient name, an invoice dated before the accident, a wiper blade on a collision claim, the same bill sent twice. Health and vehicle documents also hold identity data that many teams do not want to upload to another vendor. In Private mode nothing leaves the browser.

## Claim types and rules

| Type | Reads | Checks (on top of the common ones) |
|---|---|---|
| Health | clinic invoice, pharmacy bill, lab report | room cap per day, excluded items (cosmetic, vitamins), patient name mismatch across documents |
| Motor | workshop invoice, towing bill | document dated before the incident, labour share of invoice, maintenance or wear items, plate mismatch |
| Travel | medical bill abroad, hotel, transport, baggage | date before trip start or after trip end, excluded items (alcohol, gifts), medical bill must name the traveller |
| Expenses | meal, taxi, hotel, software receipts | per-category caps (e.g. meals), alcohol and gift exclusion, no tax line above a threshold |

Common checks: missing provider, total or date, future date, filing window, missing party or reference, per-category cap, line items vs total, no itemised lines, round total, duplicate, low model confidence. All caps and parameters are editable per type.

## How Firebase AI Logic is used (runtime)

`src/ai.js` is the only AI module:

- `getAI(app, { backend: new GoogleAIBackend() })` and `getGenerativeModel(ai, { mode, onDeviceParams, inCloudParams })`.
- Inference switch: **Private** = `ONLY_ON_DEVICE`, **Hybrid** = `PREFER_ON_DEVICE` (Gemini Nano first, cloud fallback), **Cloud** = `ONLY_IN_CLOUD`.
- Image in, structured JSON out. The `responseSchema` and prompt are built per claim type (provider, reference, party, date, currency, total, tax, category, confidence, line items).
- A second call drafts a short, neutral note to the claimant listing what is missing.
- Each card shows `ON-DEVICE` or `CLOUD`, read from `response.inferenceSource`.
- App Check is on (reCAPTCHA Enterprise), with debug-token support for local runs and judges. Images are downscaled to 1024px before sending (fewer tokens). One AI call per document. On 429/503 the cloud chain is tried in order: `gemini-3.5-flash-lite`, `gemini-4-hydrogen`, `gemini-3.8-flash` (2 tries each, backoff). If all fail, a synthetic example shows its stored read (labelled STORED EXAMPLE READ), and your own upload becomes a blank card you can type in.

## Gemini Nano path, hardened (still untested on real hardware)

- Follows the Chrome Prompt API doc: the same options (`expectedInputs` text+image, `expectedOutputs` text, language `en`) go to `availability()`, `create()` and `prompt()`; JSON answers use a plain JSON Schema as `responseConstraint`; the image is passed as an ImageBitmap; `create()` with a `monitor` for `downloadprogress` runs inside a click (user activation).
- UI states on the chip: not in this browser, not downloaded (Download button), downloading X%, ready, not supported on this device.
- Hybrid: Nano runs only when `availability()` is `available`, with a 45s limit. Any error, timeout, empty text, non-JSON or unusable fields (no total, date or provider) falls back to the cloud chain and the card says CLOUD with the reason. Private never uses the cloud and says why it cannot run. An overall 120s guard means no stuck spinner.
- `npm run test:e2e -- <url>` (needs Chrome) runs 14 scenarios with a mocked `LanguageModel`: available (hybrid and private), downloadable flow, downloading, unavailable, no API, error, timeout, bad text, empty, invalid fields. All pass on the live site. This proves our logic and the Firebase SDK wiring against a mock. It does not prove the real model works.

## Run it

You need your own Firebase project (Spark plan is enough) with Firebase AI Logic (Gemini Developer API) and App Check (reCAPTCHA Enterprise) enabled. Copy `.env.example` to `.env.local` and fill the web app config and the site key. No keys are committed.

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # policy engine tests (all four desks)
npm run build
```

Gemini Nano needs desktop Chrome with the Prompt API enabled (chrome://flags, "Prompt API for Gemini Nano"; the model downloads on first use). Without Nano, Hybrid mode uses the cloud path.

## Brand

Mark: scalloped seal with a check. Colors: obsidian #0B0D12, bone #F3EFE6, acid lime #D2FF4D, coral #FF6B5B, amber #FFC247, blue #7B8CFF. Type: Syne (display), Instrument Sans (text), JetBrains Mono (labels). Voice: plain, dry, never claims to decide a claim.

### Testing (App Check debug token)

The Firebase project requires App Check. The deployed site uses reCAPTCHA Enterprise. To run locally, create `.env.local`:

```
VITE_APPCHECK_DEBUG_TOKEN=<token we gave judges in the Devpost testing instructions>
```

or in the browser console: `localStorage.setItem("cc_appcheck_debug", "<token>")` then reload. Do not commit tokens.

## Pre-existing work and what was built in the period

Everything here was written during the submission period (Nov 11 to Nov 30, 2026) with an AI coding assistant. The brand (name, logo, palette, type) is new for this entry. No pre-existing code. Dependencies: `firebase`, `vite`. Receipts in the demo are synthetic.

## Measured accuracy (synthetic documents, cloud path)

24 synthetic images (8 examples x clean / sans-serif / degraded): all 24 read by the cloud path, 21 of 24 had all six scored fields right (87.5%); the 3 misses were an empty patient name, never a wrong value. Details, method and limits: `docs/benchmark.md`. Real documents are harder; Nano is not measured.

## Rule packs and audit trail

- Export the editable caps and parameters as a JSON rule pack and import one back (validated: known claim types, categories and parameters only, numbers from 0, nothing executable). This is the base for per-insurer rule sets.
- Audit trail (JSON): each document with its fields, which path read it (on-device, cloud, stored example, manual), the pre-check status, every finding, the handler's note, and the rules in force.

## Testing instructions for judges

1. Open https://hushmark.pages.dev (no login and no token: App Check uses reCAPTCHA Enterprise on this domain). Pick a desk, press a synthetic example (for example Motor: "Invoice before incident (held)"). Each card shows which path read it: ON-DEVICE or CLOUD.
2. Chrome on desktop with Gemini Nano: open chrome://flags, enable "Prompt API for Gemini Nano" (and "Optimization Guide On Device Model" if listed), restart. The chip next to "Reading" shows the state: not downloaded (press "Download Gemini Nano"), downloading X%, ready, or not supported on this device. When ready, Hybrid and Private read on the device and the badge says ON-DEVICE. Without Nano, Hybrid uses the cloud (badge CLOUD) and Private tells you it cannot run. We could not test the real Nano model ourselves.
3. Change a cap in "Rules, editable": every card re-checks at once. Try Export / Import rule pack and "Audit trail (JSON)".
4. Cloud mode uses the shared free Gemini quota. If it returns 429 the site tries two other models, and a synthetic example falls back to a stored read (badge STORED EXAMPLE READ).
5. Run it yourself: see "Run it" (own Firebase project, `.env.local`). `npm test` (rules, rule packs, audit) and `npm run test:e2e -- <url>` (14 Nano-state scenarios with a mocked LanguageModel).

## Honest limits

The Gemini Nano path is written to the official Chrome Prompt API and Firebase AI Logic `PREFER_ON_DEVICE` / `ONLY_ON_DEVICE` modes, but it has NOT been tested on a real Nano-capable device. The cloud fallback path is tested end to end. In Hybrid mode a browser without Nano sends the photo to Gemini in the cloud; only Private mode keeps it on the device.

No user pilot yet. No accounts or accounting-system sync. Accuracy on crumpled, handwritten or non-Latin documents is untested. Nano path depends on the browser and device. Web/Chrome only for now. Pricing shown on the site is a hypothesis, not tested with any insurer. Free-tier Gemini quota is shared per project and can return 429 under load.

## Impact: who feels it and what it costs (public sources)

- About 1 in 5 in-network claims were denied by HealthCare.gov plans in 2023 (56 million denials). Of denials with a stated reason, 21% were administrative and 14% an excluded service; 6% were medical necessity. Source: KFF, https://www.kff.org/private-insurance/claims-denials-and-appeals-in-aca-marketplace-plans-in-2023/
- Insurance fraud costs the US about $308.6B a year (all lines). Source: Coalition Against Insurance Fraud, 2022 study, https://insurancefraud.org/fraud-why-care
- OJK estimates fraud at about 5% of health insurance claims in Indonesia. Source: Kontan, 13 Jun 2025, https://keuangan.kontan.co.id/news/ojk-perkirakan-fraud-asuransi-kesehatan-5-dari-total-klaim-ini-kata-pengamat
- Users: first-line claims handlers at small insurers, TPAs and brokers. A wrongly paid claim is leakage; a wrongly denied one is an appeal. Hushmark flags document problems so a person looks first.
- Not done: no pilot, no user quotes, no measured catch rate.

## Business

See the Business section of the landing page: pricing hypothesis (Pilot free / Handler $29 per month / Team $79 per handler per month), buyer and user, and competitor notes (Shift, Tractable, Hyperscience, Rossum, Expensify, Zoho Expense, Dext).

License: Apache-2.0

`tools/` holds the Playwright scripts used for the mobile-overflow check and the demo recording (they need Chrome and a running preview).
