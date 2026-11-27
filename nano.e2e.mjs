// Browser test with a mocked Chrome LanguageModel. Usage: node tests/nano.e2e.mjs <url> [only-scenario]
// Needs Chrome + playwright-core. Cloud scenarios call the real Firebase AI Logic backend of the given site.
import { chromium } from "playwright-core";
const base = process.argv[2] || "http://localhost:4173/";
const only = process.argv[3];
const GOOD = JSON.stringify({ provider: "Klinik Sehat", reference: "INV-1", party: "Rina Putri", date: "2026-10-20", currency: "USD", total: 79.5, category: "Consultation", confidence: 0.9, lineItems: [{ description: "Consultation", amount: 45 }, { description: "Blood test", amount: 34.5 }] });

const scenarios = [
  { name: "available_ok", state: "available", out: GOOD, mode: "hybrid", expect: { badge: /ON-DEVICE/, chip: "available", prompted: true } },
  { name: "available_private_ok", state: "available", out: GOOD, mode: "private", expect: { badge: /ON-DEVICE/, chip: "available", prompted: true, noCloud: true } },
  { name: "downloadable_flow", state: "downloadable", download: true, out: GOOD, mode: "hybrid", expect: { chip: "downloadable", downloadFlow: true } },
  { name: "downloading_hybrid_uses_cloud", state: "downloading", mode: "hybrid", expect: { badge: /CLOUD/, chip: "downloading", prompted: false } },
  { name: "unavailable_hybrid_uses_cloud", state: "unavailable", mode: "hybrid", expect: { badge: /CLOUD/, chip: "unavailable", prompted: false } },
  { name: "unavailable_private_blocks", state: "unavailable", mode: "private", expect: { noCloud: true, logErr: /Private mode never uses the cloud/ } },
  { name: "downloadable_private_blocks", state: "downloadable", mode: "private", expect: { noCloud: true, logErr: /not downloaded yet/ } },
  { name: "error_falls_back", state: "available", out: "THROW", mode: "hybrid", expect: { badge: /CLOUD/, prompted: true, logErr: /Nano did not give a usable answer/ } },
  { name: "timeout_falls_back", state: "available", out: "HANG", mode: "hybrid", timeoutMs: 1500, expect: { badge: /CLOUD/, prompted: true, logErr: /timed out/ } },
  { name: "bad_text_falls_back", state: "available", out: "sorry, I cannot read this", mode: "hybrid", expect: { badge: /CLOUD/, prompted: true } },
  { name: "empty_falls_back", state: "available", out: "", mode: "hybrid", expect: { badge: /CLOUD/, prompted: true } },
  { name: "invalid_fields_fall_back", state: "available", out: JSON.stringify({ provider: "X", date: "soon", total: 0 }), mode: "hybrid", expect: { badge: /CLOUD/, prompted: true } },
  { name: "error_private_reports", state: "available", out: "THROW", mode: "private", expect: { noCloud: true, logErr: /On-device read failed/ } },
  { name: "no_api", noApi: true, mode: "hybrid", expect: { badge: /CLOUD/, chip: "unsupported" } },
];

const b = await chromium.launch({ executablePath: process.env.CHROME || "/usr/bin/google-chrome", args: ["--no-sandbox"] });
let fails = 0;
for (const sc of scenarios.filter((s) => !only || s.name === only)) {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const cloud = [];
  page.on("request", (r) => { if (/firebasevertexai|generativelanguage|aiplatform|firebaseml/.test(r.url())) cloud.push(r.url()); });
  await page.addInitScript((sc) => {
    if (sc.timeoutMs) localStorage.setItem("hm_nano_timeout", String(sc.timeoutMs));
    const rec = { av: [], cr: [], pr: [] }; window.__lm = rec;
    if (sc.noApi) { try { delete window.LanguageModel; } catch {} Object.defineProperty(window, "LanguageModel", { value: undefined, configurable: true }); return; }
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    let state = sc.state;
    window.LanguageModel = {
      async availability(o) { rec.av.push(JSON.parse(JSON.stringify(o || null))); return state; },
      async create(o = {}) {
        rec.cr.push({ ei: o.expectedInputs, eo: o.expectedOutputs, monitor: !!o.monitor });
        if (o.monitor && sc.download) {
          const t = new EventTarget(); o.monitor(t);
          for (const f of [0.25, 0.5, 1]) { await sleep(700); const ev = new Event("downloadprogress"); ev.loaded = f; t.dispatchEvent(ev); }
          state = "available";
        }
        return {
          async prompt(msgs, po) {
            rec.pr.push({ po: po ? { rc: po.responseConstraint?.type } : null, n: Array.isArray(msgs) ? msgs.length : 1, img: JSON.stringify(msgs, (k, v) => (v && v.constructor && /ImageBitmap/.test(v.constructor.name) ? "IMG" : v)).includes("IMG") });
            if (sc.out === "THROW") throw new Error("mock model crashed");
            if (sc.out === "HANG") return new Promise(() => {});
            return sc.out ?? "";
          },
          destroy() {},
        };
      },
    };
  }, sc);
  await page.goto(base); await page.waitForTimeout(1200);
  const problems = [];
  await page.selectOption("#mode", sc.mode).catch(() => {});
  await page.waitForFunction(() => document.querySelector("#nano-chip")?.dataset.state, null, { timeout: 8000 }).catch(() => problems.push("chip never got a state"));
  const chipState = await page.$eval("#nano-chip", (e) => e.dataset.state).catch(() => "");
  if (sc.expect.chip && chipState !== sc.expect.chip) problems.push(`chip state ${chipState} != ${sc.expect.chip}`);
  if (sc.expect.downloadFlow) {
    await page.click("#nano-dl");
    await page.waitForFunction(() => /downloading \d+%/.test(document.querySelector("#nano-chip").textContent), null, { timeout: 6000 }).catch(() => problems.push("no download % shown"));
    await page.waitForFunction(() => document.querySelector("#nano-chip").dataset.state === "available", null, { timeout: 8000 }).catch(() => problems.push("never reached ready"));
    const hidden = await page.$eval("#nano-dl", (e) => e.hidden); if (!hidden) problems.push("download button still visible");
    const cr = await page.evaluate(() => window.__lm.cr); if (!cr.some((c) => c.monitor)) problems.push("create() had no monitor");
  } else {
    await page.click("#samples button >> nth=0");
    const ok = await page.waitForFunction(() => /Done in|AI could not read|Live AI is busy|stored read/.test(document.querySelector("#log")?.textContent || ""), null, { timeout: 90000 }).then(() => true).catch(() => false);
    if (!ok) problems.push("STUCK: no final log line in 90s");
    const badge = await page.$eval(".claim .badge", (e) => e.textContent).catch(() => "");
    const logTxt = await page.$eval("#log", (e) => e.textContent);
    if (sc.expect.badge && !sc.expect.badge.test(badge)) problems.push(`badge "${badge}" !~ ${sc.expect.badge}`);
    if (sc.expect.logErr && !sc.expect.logErr.test(logTxt)) problems.push(`log lacks ${sc.expect.logErr}`);
    if (!sc.expect.badge && /^ON-DEVICE|^CLOUD/.test(badge)) problems.push(`unexpected badge ${badge}`);
  }
  const lm = await page.evaluate(() => window.__lm);
  if (!sc.noApi && sc.expect.prompted !== undefined) {
    if ((lm.pr.length > 0) !== sc.expect.prompted) problems.push(`prompt calls ${lm.pr.length}, expected prompted=${sc.expect.prompted}`);
  }
  if (!sc.noApi && lm.av.length) {
    const same = lm.av.every((a) => JSON.stringify(a) === JSON.stringify(lm.av[0]));
    if (!same) problems.push("availability() options differ between calls");
    const first = lm.cr[0]; if (first && (JSON.stringify(first.ei) !== JSON.stringify(lm.av[0].expectedInputs) || JSON.stringify(first.eo) !== JSON.stringify(lm.av[0].expectedOutputs))) problems.push("create() options differ from availability() options");
    if (lm.av[0].expectedInputs?.[0]?.languages?.[0] !== "en" || !lm.av[0].expectedOutputs) problems.push("availability() lacks languages/expectedOutputs");
  }
  if (sc.expect.prompted && lm.pr[0]) { if (lm.pr[0].po?.rc !== "object") problems.push("responseConstraint is not a JSON Schema object"); if (!lm.pr[0].img) problems.push("image not passed to Nano"); }
  if (sc.expect.noCloud && cloud.length) problems.push(`cloud was called ${cloud.length}x in a no-cloud case`);
  console.log(`${problems.length ? "FAIL" : "PASS"}  ${sc.name}${problems.length ? "  <- " + problems.join("; ") : ""}`);
  fails += problems.length ? 1 : 0;
  await ctx.close();
}
await b.close();
console.log(fails ? `${fails} scenario(s) failed` : "all scenarios passed");
process.exit(fails ? 1 : 0);
