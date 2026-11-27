import { chromium } from "/home/sandbox/claimcheck/node_modules/playwright-core/index.mjs";
const base = process.argv[2], tag = process.argv[3]||"";
const b = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
for (const [w,h,mob] of [[980,2100,false],[390,844,true],[412,915,true],[360,800,true],[1280,800,false]]) {
  const p = await b.newPage({ viewport:{width:w,height:h}, isMobile:mob, deviceScaleFactor:2 });
  await p.goto(base); await p.waitForTimeout(1500);
  await p.screenshot({path:`/downloads/hm${tag}-hero-${w}.png`});
  await p.evaluate(async()=>{for(let y=0;y<document.body.scrollHeight;y+=500){scrollTo(0,y);await new Promise(r=>setTimeout(r,50));}});
  const r = await p.evaluate(() => { const W=document.documentElement.clientWidth, bad=[];
    document.querySelectorAll("body *").forEach(e=>{ if(e.closest(".ticker,.twrap,.code,.hero-art")) return; const b=e.getBoundingClientRect(); if(b.width&&(b.right>W+1||b.left<-1)) bad.push(e.tagName+"."+String(e.className).slice(0,20)+" "+Math.round(b.right)); });
    const hero=document.querySelector(".hero").getBoundingClientRect().height;
    return {W, sw:document.documentElement.scrollWidth, hero:Math.round(hero), bad:bad.slice(0,6), secs:[...document.querySelectorAll("section,footer")].filter(s=>s.scrollWidth>s.clientWidth).map(s=>s.id||s.className)}; });
  console.log(w+"x"+h, JSON.stringify(r));
  await p.evaluate(()=>scrollTo(0,99999)); await p.waitForTimeout(400); await p.screenshot({path:`/downloads/hm${tag}-footer-${w}.png`});
  await p.close();
}
await b.close();
