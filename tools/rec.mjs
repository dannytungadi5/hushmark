import { chromium } from "/home/sandbox/claimcheck/node_modules/playwright-core/index.mjs";
import fs from "fs";
const URL = "https://hushmark.pages.dev/";
const b = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const smooth = (p, sel, off = -20) => p.evaluate(([s, o]) => { const el = document.querySelector(s); window.scrollTo({ top: el.getBoundingClientRect().top + scrollY + o, behavior: "smooth" }); }, [sel, off]);
async function beat(id, secs, fn) {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: `/downloads/video/raw${id}`, size: { width: 1280, height: 720 } } });
  const p = await ctx.newPage(); await p.goto(URL); await sleep(1200);
  const t0 = Date.now(); await fn(p); const left = secs * 1000 - (Date.now() - t0); if (left > 0) await sleep(left);
  await ctx.close(); console.log("beat", id, "done", Math.round((Date.now() - t0) / 1000));
}
const ready = (p) => p.waitForSelector(".claim", { timeout: 60000 });
const only=process.argv[2];
if(only==='1') await beat(1, 15.5, async (p) => { await sleep(7000); await smooth(p, ".ticker", -300); });
if(only==='2') await beat(2, 14, async (p) => { await smooth(p, "#desks", -10); await sleep(4000); await p.hover("#desks > * >> nth=0").catch(() => {}); });
if(only==='3') await beat(3, 16.2, async (p) => { await smooth(p, "#app", -10); await sleep(1500); await p.click('#types button[data-t="motor"]'); await sleep(1200); await p.click('#samples button[data-s="m-late"]'); await ready(p); await sleep(1500); });
if(only==='4') await beat(4, 16, async (p) => { await smooth(p, "#app", -10); await p.click('#types button[data-t="motor"]'); await p.click('#samples button[data-s="m-late"]'); await ready(p); await sleep(1500); await smooth(p, ".claim", -140); await sleep(3000); await smooth(p, ".claim .flags", -300); });
if(only==='5') await beat(5, 15.5, async (p) => { await smooth(p, "#app", -10); await p.click('#types button[data-t="expenses"]'); await sleep(600); await p.click('#samples button[data-s="e-dinner"]'); await ready(p); await sleep(1500); await smooth(p, ".claim", -140); await sleep(2000); await p.click('[data-act="draft"]').catch(() => {}); await sleep(5000); });
if(only==='6') await beat(6, 13, async (p) => { await smooth(p, "#mode", -250); await sleep(2500); await p.focus("#mode"); await sleep(3000); await smooth(p, "#drop", -150); });
if(only==='7') await beat(7, 20.3, async (p) => { await smooth(p, "#business", -10); await sleep(7000); await smooth(p, "#compete", -10); await sleep(7000); await smooth(p, "#usp", -10); });
if(only==='8') await beat(8, 9.3, async (p) => { await smooth(p, "footer", -300); await sleep(3000); });
await b.close();
