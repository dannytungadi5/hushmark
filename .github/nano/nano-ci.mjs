// CI probe: does Gemini Nano (Chrome Prompt API) work on a real desktop Chrome on a GitHub-hosted Windows runner?
import puppeteer from 'puppeteer-core';
import os from 'node:os';
import fs from 'node:fs';
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = 'https://hushmark.pages.dev/';
const log = (...a) => console.log('[nano-ci]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
log('cpus', os.cpus().length, 'ramGB', (os.totalmem() / 2 ** 30).toFixed(1));
const OPTS = { expectedInputs: [{ type: 'text', languages: ['en'] }], expectedOutputs: [{ type: 'text', languages: ['en'] }] };
const results = {};
const deepText = () => { const out = []; const walk = (n) => { if (n.nodeType === 3) { const t = n.textContent.trim(); if (t) out.push(t); } if (n.shadowRoot) walk(n.shadowRoot); n.childNodes && n.childNodes.forEach(walk); }; walk(document.body); return out.join(' | '); };
const deepClick = (rx) => { const walk = (n) => { if (n.nodeType === 1 && n.tagName === 'BUTTON' && new RegExp(rx, 'i').test(n.textContent)) { n.click(); return true; } if (n.shadowRoot && walk(n.shadowRoot)) return true; for (const c of n.childNodes || []) if (walk(c)) return true; return false; }; return walk(document.body); };
async function attempt(name, { localStateFlags, features }) {
  const dir = 'C:\\nano-' + name;
  fs.mkdirSync(dir, { recursive: true });
  if (localStateFlags) fs.writeFileSync(dir + '\\Local State', JSON.stringify({ browser: { enabled_labs_experiments: localStateFlags } }));
  const args = ['--no-first-run', '--no-sandbox'];
  if (features) args.push('--enable-features=' + features);
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: false, userDataDir: dir, args,
    ignoreDefaultArgs: ['--disable-component-update', '--disable-extensions', '--enable-automation', '--disable-background-networking'] });
  const page = await browser.newPage();
  await page.goto(URL, { waitUntil: 'networkidle2' });
  await page.click('body');
  const avail = (o) => page.evaluate(async (o) => (typeof LanguageModel === 'undefined' ? 'no-api' : await LanguageModel.availability(o)), o);
  let av = await avail(OPTS); log(name, 'availability', av);
  const r = { first: av };
  try {
    const p2 = await browser.newPage();
    await p2.goto('chrome://chrome-urls', { waitUntil: 'load' }); await sleep(1500);
    log(name, 'enable debug pages click:', await p2.evaluate(deepClick, 'enable'));
    await sleep(1500);
    await p2.goto('chrome://on-device-internals', { waitUntil: 'load' }); await sleep(5000);
    const txt = await p2.evaluate(deepText).catch((e) => 'err ' + e);
    log(name, 'internals:', String(txt).replace(/\s+/g, ' ').slice(0, 1500));
    await p2.screenshot({ path: 'nano-' + name + '-internals.png' }).catch(() => {});
    await p2.close();
  } catch (e) { log(name, 'internals err', String(e).slice(0, 160)); }
  av = await avail(OPTS); log(name, 'availability recheck', av);
  if (av === 'downloadable' || av === 'downloading') {
    const d = await Promise.race([
      page.evaluate(async (o) => { let last = 0; try { const s = await LanguageModel.create({ ...o, monitor(m) { m.addEventListener('downloadprogress', (e) => { last = e.loaded; }); } }); s.destroy(); return { created: true, last }; } catch (e) { return { created: false, error: String(e), last }; } }, OPTS),
      sleep(20 * 60 * 1000).then(() => ({ created: false, error: 'timeout 20min' })),
    ]);
    log(name, 'download', JSON.stringify(d)); r.download = d; av = await avail(OPTS); log(name, 'availability after', av);
  }
  if (av === 'available') {
    const out = await page.evaluate(async (o) => { const s = await LanguageModel.create(o); const t = performance.now(); const x = await s.prompt('Reply with a JSON object {"ok":true} and nothing else.'); return { x, ms: Math.round(performance.now() - t) }; }, OPTS);
    log(name, 'prompt', JSON.stringify(out)); r.prompt = out;
  }
  r.final = av; results[name] = r;
  await page.screenshot({ path: 'nano-' + name + '-site.png' });
  await browser.close();
  return av;
}
const tries = [
  ['flags', { localStateFlags: ['optimization-guide-on-device-model@2', 'prompt-api-for-gemini-nano@1'] }],
  ['features', { features: 'PromptAPIForGeminiNano,OptimizationGuideOnDeviceModel:BypassPerfRequirement/true' }],
];
for (const [n, o] of tries) { try { if ((await attempt(n, o)) === 'available') break; } catch (e) { log(n, 'error', String(e).slice(0, 300)); } }
fs.writeFileSync('nano-ci-result.json', JSON.stringify(results, null, 2));
