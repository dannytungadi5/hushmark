// CI probe: does Gemini Nano (Chrome Prompt API) work on a real desktop Chrome on a GitHub-hosted Windows runner?
import puppeteer from 'puppeteer-core';
import os from 'node:os';
import { execSync } from 'node:child_process';
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = 'https://hushmark.pages.dev/';
const log = (...a) => console.log('[nano-ci]', ...a);
log('cpus', os.cpus().length, 'ramGB', (os.totalmem() / 2 ** 30).toFixed(1));
try { log(execSync('powershell -c "Get-PSDrive -PSProvider FileSystem | Format-Table Name,Used,Free -auto | Out-String"').toString()); } catch (e) { log('disk check failed'); }
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: false, userDataDir: 'C:\\nano-profile',
  ignoreDefaultArgs: ['--disable-component-update', '--disable-extensions', '--enable-automation'],
  args: ['--no-first-run', '--no-sandbox',
    '--enable-features=OptimizationGuideOnDeviceModel:BypassPerfRequirement/true,PromptAPIForGeminiNano,OptimizationGuideOnDeviceModel',
    '--disable-features=OnDeviceModelPerformanceParams'],
});
log('chrome', await browser.version());
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
await page.goto(URL, { waitUntil: 'networkidle2' });
await page.click('body');
const run = (fn, ...args) => page.evaluate(fn, ...args);
let av = await run(async () => (typeof LanguageModel === 'undefined' ? 'no-api' : await LanguageModel.availability({ expectedInputs: [{ type: 'text', languages: ['en'] }], expectedOutputs: [{ type: 'text', languages: ['en'] }] })));
log('availability', av);
let result = { availability: av };
if (av === 'downloadable' || av === 'downloading') {
  const t0 = Date.now();
  const r = await Promise.race([
    run(async () => {
      let last = 0;
      try {
        const s = await LanguageModel.create({ expectedInputs: [{ type: 'text', languages: ['en'] }], expectedOutputs: [{ type: 'text', languages: ['en'] }], monitor(m) { m.addEventListener('downloadprogress', (e) => { last = e.loaded; }); } });
        s.destroy(); return { created: true, last };
      } catch (e) { return { created: false, error: String(e), last }; }
    }),
    new Promise((res) => setTimeout(() => res({ created: false, error: 'timeout 25min' }), 25 * 60 * 1000)),
  ]);
  log('download result', JSON.stringify(r), 'secs', Math.round((Date.now() - t0) / 1000));
  result.download = r;
  av = await run(async () => LanguageModel.availability({ expectedInputs: [{ type: 'text', languages: ['en'] }], expectedOutputs: [{ type: 'text', languages: ['en'] }] }));
  log('availability after', av); result.after = av;
}
if (av === 'available') {
  const out = await run(async () => {
    const s = await LanguageModel.create({ expectedInputs: [{ type: 'text', languages: ['en'] }], expectedOutputs: [{ type: 'text', languages: ['en'] }] });
    const t0 = performance.now();
    const o = await s.prompt('Reply with a JSON object {"ok":true} and nothing else.');
    return { o, ms: Math.round(performance.now() - t0) };
  });
  log('prompt result', JSON.stringify(out)); result.prompt = out;
}
await page.reload({ waitUntil: 'networkidle2' });
await new Promise((r) => setTimeout(r, 3000));
await page.screenshot({ path: 'nano-ci-site.png' });
await page.goto('chrome://on-device-internals', { waitUntil: 'load' }).catch(() => {});
await new Promise((r) => setTimeout(r, 3000));
await page.screenshot({ path: 'nano-ci-internals.png' }).catch(() => {});
import fs from 'node:fs'; fs.writeFileSync('nano-ci-result.json', JSON.stringify(result, null, 2));
await browser.close();
