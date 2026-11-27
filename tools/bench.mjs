// Accuracy benchmark on SYNTHETIC documents: the in-app sample layout plus two degraded variants.
// Usage: node tools/bench.mjs <url> [out.json]. Runs the real cloud path of the given site through its UI (one call per document).
import { chromium } from "playwright-core";
import fs from "node:fs";
import { SAMPLES } from "../src/samples.js";
const base = process.argv[2], out = process.argv[3] || "/tmp/bench-results.json";
const iso = (off) => { const d = new Date(); d.setDate(d.getDate() + off); return d.toISOString().slice(0, 10); };
const b = await chromium.launch({ executablePath: process.env.CHROME || "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const page = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
await page.goto(base); await page.waitForTimeout(1500);
await page.selectOption("#mode", "cloud");
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const results = [];
fs.mkdirSync("/tmp/bench", { recursive: true });

async function draw(s, variant) {
  return page.evaluate(async ({ s, variant, date }) => {
    const font = (variant === "sans" || variant === "indo") ? "Arial, sans-serif" : "'Courier New', monospace";
    const L = variant === "indo" ? { date: "TANGGAL", ref: "NO. REF", name: "NAMA", tax: "PPN", total: "TOTAL" } : { date: "DATE", ref: "REF", name: "NAME", tax: "TAX", total: "TOTAL USD" };
    const sub = s.lines.reduce((a, l) => a + l[1], 0), tax = s.tax || 0;
    const W = 520, H = 400 + s.lines.length * 44 + 160;
    const c = document.createElement("canvas"); c.width = W; c.height = H; const g = c.getContext("2d");
    g.fillStyle = "#fbfaf4"; g.fillRect(0, 0, W, H); g.fillStyle = "#1b1b18"; g.textAlign = "center";
    g.font = `bold 28px ${font}`; g.fillText(s.title.toUpperCase(), W / 2, 66);
    g.font = `20px ${font}`; g.fillText(s.sub, W / 2, 98); g.fillText(`${L.date}: ${date}`, W / 2, 130);
    g.textAlign = "left"; g.fillText(`${L.ref}: ${s.ref}`, 30, 170); g.fillText(`${L.name}: ${s.party}`, 30, 200); g.fillText("-".repeat(36), 30, 230);
    let y = 270;
    for (const [n, a] of s.lines) { g.fillText(n, 30, y); g.textAlign = "right"; g.fillText(a.toFixed(2), W - 30, y); g.textAlign = "left"; y += 44; }
    g.fillText("-".repeat(36), 30, y); y += 40;
    if (tax) { g.fillText(L.tax, 30, y); g.textAlign = "right"; g.fillText(tax.toFixed(2), W - 30, y); g.textAlign = "left"; y += 40; }
    g.font = `bold 26px ${font}`; g.fillText(L.total, 30, y + 6); g.textAlign = "right"; g.fillText((sub + tax).toFixed(2), W - 30, y + 6);
    const hard = variant === "tilt"; if (variant !== "degraded" && !hard) return c.toDataURL("image/jpeg", 0.9);
    // degraded: rotate 2.5 degrees, blur, noise, low JPEG quality, 0.7 scale
    const d = document.createElement("canvas"); const sc = hard ? 0.55 : 0.7; d.width = Math.round(W * sc); d.height = Math.round(H * sc); const h = d.getContext("2d");
    h.fillStyle = "#d8d4c8"; h.fillRect(0, 0, d.width, d.height); h.filter = hard ? "blur(1.3px)" : "blur(0.7px)";
    h.translate(d.width / 2, d.height / 2); h.rotate(((hard ? -7 : 2.5) * Math.PI) / 180); h.drawImage(c, -d.width / 2, -d.height / 2, d.width, d.height);
    h.setTransform(1, 0, 0, 1, 0, 0); h.filter = "none";
    const im = h.getImageData(0, 0, d.width, d.height);
    for (let i = 0; i < im.data.length; i += 4) { const n = (Math.random() - 0.5) * (hard ? 56 : 36); im.data[i] += n; im.data[i + 1] += n; im.data[i + 2] += n; }
    h.putImageData(im, 0, 0);
    return d.toDataURL("image/jpeg", hard ? 0.4 : 0.5);
  }, { s, variant, date });
}
let date;
for (const mode of ["health", "motor", "travel", "expenses"]) {
  await page.click(`#types button[data-t="${mode}"]`);
  for (const s of SAMPLES[mode]) for (const variant of (process.env.VARIANTS || "clean,sans,degraded,tilt,indo").split(",")) {
    date = iso(s.d);
    const url = await draw(s, variant);
    const file = `/tmp/bench/${s.id}-${variant}.jpg`; fs.writeFileSync(file, Buffer.from(url.split(",")[1], "base64"));
    const before = await page.$$eval(".claim", (e) => e.length);
    await page.evaluate(() => { document.querySelector("#log").innerHTML = ""; });
    await page.setInputFiles("#file", file);
    const done = await page.waitForFunction(() => /Done in|AI could not read|stored read|Live AI is busy/.test(document.querySelector("#log")?.textContent || ""), null, { timeout: 100000 }).then(() => true).catch(() => false);
    const logTxt = await page.$eval("#log", (e) => e.textContent);
    const card = await page.evaluate(() => {
      const c = document.querySelector(".claim"); if (!c) return null; const v = (f) => c.querySelector(`[data-f="${f}"]`)?.value ?? "";
      return { provider: v("provider"), date: v("date"), total: Number(v("total")), category: v("category"), party: v("party"), reference: v("reference"), badge: c.querySelector(".badge")?.textContent || "", flags: [...c.querySelectorAll(".flags li")].map((x) => x.textContent) };
    });
    const t = { provider: s.title, reference: s.ref, party: s.party, date, total: +(sub(s)).toFixed(2), category: s.cat };
    const ok = card && /CLOUD/.test(card.badge);
    const r = { id: s.id, mode, variant, ok: !!ok, badge: card?.badge || "", fields: {} };
    if (ok) {
      r.fields.provider = norm(card.provider).includes(norm(t.provider)) || norm(t.provider).includes(norm(card.provider)) && norm(card.provider).length > 4;
      r.fields.reference = norm(card.reference) === norm(t.reference);
      r.fields.party = norm(card.party) === norm(t.party);
      r.fields.date = card.date === t.date;
      r.fields.total = Math.abs(card.total - t.total) < 0.01;
      r.fields.category = card.category === t.category;
    }
    r.got = card; r.truth = t; r.log = logTxt.slice(0, 200);
    results.push(r);
    console.log(`${s.id}/${variant}: ${ok ? Object.entries(r.fields).map(([k, v]) => (v ? "+" : "-") + k).join(" ") : "NOT CLOUD READ: " + logTxt.slice(0, 80)}`);
    await page.waitForTimeout(1500);
    fs.writeFileSync(out, JSON.stringify(results, null, 1));
  }
}
function sub(s) { return s.lines.reduce((a, l) => a + l[1], 0) + (s.tax || 0); }
await b.close();
