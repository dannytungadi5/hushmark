import { chromium } from "/home/sandbox/claimcheck/node_modules/playwright-core/index.mjs";
const base = process.argv[2];
const b = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
for (const w of [360,390,412]) {
  const p = await b.newPage({ viewport:{width:w,height:800}, isMobile:true, deviceScaleFactor:2 });
  await p.goto(base); await p.waitForTimeout(1500);
  await p.evaluate(async()=>{for(let y=0;y<document.body.scrollHeight;y+=600){scrollTo(0,y);await new Promise(r=>setTimeout(r,60));}});
  const r = await p.evaluate(() => {
    const W = document.documentElement.clientWidth; const bad=[];
    document.querySelectorAll("body *").forEach(e=>{ if(e.closest(".ticker,.twrap,.code,.hero-art")) return; const b=e.getBoundingClientRect(); if(b.width&&(b.right>W+1||b.left<-1)) bad.push(e.tagName+"."+String(e.className).slice(0,20)+" "+Math.round(b.right)); });
    const secs=[...document.querySelectorAll("section,footer,nav")].map(s=>[s.id||s.className||s.tagName, s.scrollWidth, s.clientWidth]).filter(x=>x[1]>x[2]);
    return {W, sw:document.documentElement.scrollWidth, bad:bad.slice(0,8), secs};
  });
  console.log(w, JSON.stringify(r));
  if (w===390) { await p.evaluate(()=>scrollTo(0,99999)); await p.waitForTimeout(400); await p.screenshot({path:"/downloads/hm-footer-390.png"}); }
  await p.close();
}
await b.close();
