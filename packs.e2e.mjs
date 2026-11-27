// Rule pack import/export and audit trail in a real browser. Usage: node tests/packs.e2e.mjs <url>
import { chromium } from "playwright-core";
import fs from "node:fs";
const base = process.argv[2] || "http://localhost:4173/";
const b = await chromium.launch({ executablePath: process.env.CHROME || "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const ctx = await b.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage(); const bad = [];
await page.goto(base); await page.waitForTimeout(1200);
// export
const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#rules-export")]);
const pack = JSON.parse(fs.readFileSync(await dl.path(), "utf8"));
if (pack.format !== "hushmark-rules" || !pack.rules.health) bad.push("export shape");
// import invalid
fs.writeFileSync("/tmp/bad-pack.json", JSON.stringify({ format: "hushmark-rules", version: 1, rules: { health: { limits: { Consultation: -1 } } } }));
await page.setInputFiles("#rules-file", "/tmp/bad-pack.json");
if (!/Not imported/.test(await page.textContent("#rules-msg"))) bad.push("bad pack accepted");
// import valid and see the cap change in the UI
pack.rules.health.limits.Consultation = 77; fs.writeFileSync("/tmp/ok-pack.json", JSON.stringify(pack));
await page.setInputFiles("#rules-file", "/tmp/ok-pack.json");
if (!/Imported/.test(await page.textContent("#rules-msg"))) bad.push("good pack rejected");
if ((await page.inputValue('#limits input[data-k="Consultation"]')) !== "77") bad.push("cap not applied");
// audit trail after one example
await page.click("#samples button >> nth=0");
await page.waitForFunction(() => /Done in|stored read|Live AI is busy|AI could not read/.test(document.querySelector("#log")?.textContent || ""), null, { timeout: 90000 });
const [ad] = await Promise.all([page.waitForEvent("download"), page.click("#audit")]);
const audit = JSON.parse(fs.readFileSync(await ad.path(), "utf8"));
if (audit.format !== "hushmark-audit" || audit.documents.length < 1 || !audit.documents[0].read_by || audit.rules.health.limits.Consultation !== 77) bad.push("audit shape");
console.log(bad.length ? "FAIL " + bad.join("; ") : "PASS packs + audit");
await b.close(); process.exit(bad.length ? 1 : 0);
