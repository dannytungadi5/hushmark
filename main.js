import "./style.css";
import { PROFILES, MODE_IDS, defaultPolicy, checkClaim, summarize, toCSV, exportRulePack, parseRulePack, auditJSON } from "./policy.js";
import { nanoState, downloadNano } from "./nano.js";
import { sampleList, renderSample, sampleSetup } from "./samples.js";

const $ = (s) => document.querySelector(s);
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { localStorage.setItem(k, JSON.stringify(v)); },
};
let claims = store.get("cc_claims2", []);
let type = MODE_IDS.includes(store.get("cc_type", "")) ? store.get("cc_type", "") : "health";
const saved = store.get("cc_pol2", {});
const policies = Object.fromEntries(MODE_IDS.map((m) => { const d = defaultPolicy(m); return [m, { ...d, ...(saved[m] || {}), limits: { ...d.limits, ...(saved[m]?.limits || {}) }, params: { ...d.params, ...(saved[m]?.params || {}) } }]; }));
const pol = () => policies[type];
const mine = () => claims.filter((c) => (c.mode || "health") === type);
let ai = null; // lazy-loaded so the page paints before Firebase loads

const log = (msg, err) => { const d = document.createElement("div"); if (err) d.className = "err"; d.textContent = `${new Date().toLocaleTimeString()}  ${msg}`; $("#log").prepend(d); };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const uid = () => Math.random().toString(36).slice(2, 10);

async function loadAI() { return (ai ||= await import("./ai.js")); }

async function thumb(blob) {
  const bmp = await createImageBitmap(blob);
  const s = 240 / bmp.width, c = document.createElement("canvas");
  c.width = 240; c.height = Math.round(bmp.height * s);
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.6);
}

function recheck() {
  for (const c of claims) c.flags = checkClaim(c, claims, policies[c.mode || "health"], c.mode || "health");
  store.set("cc_claims2", claims);
  render();
}

function render() {
  const list = mine(), P = PROFILES[type];
  const s = summarize(list, pol().currency);
  $("#summary").innerHTML = list.length
    ? `<div class="stat"><b>${s.count}</b><span>documents</span></div><div class="stat"><b>${s.total.toFixed(2)}</b><span>${esc(pol().currency)} total</span></div>
       <div class="stat good"><b>${s.clean}</b><span>clear</span></div><div class="stat mid"><b>${s.warned}</b><span>to review</span></div><div class="stat bad"><b>${s.blocked}</b><span>on hold</span></div>`
    : "";
  $("#claims").innerHTML = list.length ? list.map(cardHTML).join("") : `<div class="empty">No ${esc(P.label.toLowerCase())} documents yet. Drop a photo or click an example on the left.</div>`;
}

function cardHTML(c) {
  const P = PROFILES[c.mode || "health"];
  const f = c.flags || [];
  const cls = f.some((x) => x.severity === "block") ? "block" : f.length ? "warn" : "";
  const src = c.source === "on-device" ? `<span class="badge">ON-DEVICE · Gemini Nano</span>` : c.source === "in-cloud" ? `<span class="badge cloud" title="${esc(c.note || "")}">CLOUD · Gemini</span>` : c.source === "cached example" ? `<span class="badge manual">STORED EXAMPLE READ</span>` : `<span class="badge manual">MANUAL</span>`;
  const verdict = cls === "block" ? "Hold for handler" : cls === "warn" ? "Review" : "Clear";
  return `<div class="claim ${cls}${c._new ? " fresh" : ""}" data-id="${c.id}">
    ${c.thumb ? `<img alt="claim document" src="${c.thumb}">` : `<div></div>`}
    <div>
      <div class="row"><span class="verdict ${cls}">${verdict}</span>${src}${c.confidence != null ? `<span class="mini">confidence ${(c.confidence * 100) | 0}%</span>` : ""}<button class="link rm" data-act="rm">remove</button></div>
      <div class="row">
        <input class="m" data-f="provider" value="${esc(c.provider)}" placeholder="Provider" aria-label="Provider">
        <input type="date" data-f="date" value="${esc(c.date)}" aria-label="Date">
        <input class="n" type="number" step="0.01" data-f="total" value="${c.total ?? ""}" aria-label="Total">
        <span class="mini">${esc(c.currency || "USD")}</span>
        <select data-f="category" aria-label="Category">${P.categories.map((k) => `<option${k === c.category ? " selected" : ""}>${k}</option>`).join("")}</select>
      </div>
      <div class="row">
        <input class="m" data-f="party" value="${esc(c.party)}" placeholder="${esc(P.party)}" aria-label="${esc(P.party)}">
        <input class="m" data-f="reference" value="${esc(c.reference)}" placeholder="${esc(P.reference)}" aria-label="${esc(P.reference)}">
      </div>
      ${f.length ? `<ul class="flags">${f.map((x) => `<li class="${x.severity}">${esc(x.message)}</li>`).join("")}</ul>` : `<span class="mini">No findings. A handler still makes the decision.</span>`}
      ${f.length ? `<div class="just"><input data-f="justification" value="${esc(c.justification || "")}" placeholder="Note to claimant (optional)"><button class="btn small ghost" data-act="draft">Draft with AI</button></div>` : ""}
    </div></div>`;
}

async function addImage(blob, name, cached) {
  const mode = $("#mode").value;
  log(`Reading ${name} (${PROFILES[type].label}, ${mode})…`);
  const t0 = performance.now();
  const th = await thumb(blob).catch(() => "");
  const base = { id: uid(), mode: type, thumb: th };
  try {
    const mod = await loadAI();
    // Never a stuck spinner: a hard overall limit on top of the per-step timeouts.
    const { claim, source, note } = await Promise.race([
      mod.extractDocument(blob, mode, type, (m) => log(m)),
      new Promise((_, rej) => setTimeout(() => rej(new Error("The read took too long")), 120000)),
    ]);
    claims.unshift({ ...base, _new: 1, ...claim, source, note, currency: claim.currency || pol().currency });
    if (note) log(note, true);
    log(`Done in ${((performance.now() - t0) / 1000).toFixed(1)}s via ${source}.`);
  } catch (e) {
    const m = String(e?.message || e);
    if (cached) { // synthetic example only: show the stored read so the demo never dead-ends when the shared AI quota is full
      claims.unshift({ ...base, _new: 1, ...cached, source: "cached example" });
      log(mode === "private" ? `${m.slice(0, 170)} Showing the stored read of this synthetic example instead. Nothing was uploaded.` : `Live AI is busy (${m.slice(0, 60)}). Showing the stored read of this synthetic example. Your own uploads always use live AI.`, true);
      recheck(); return;
    }
    log(`AI could not read it: ${m.slice(0, 160)}. Added as a blank card so you can type it in.`, true);
    claims.unshift({ ...base, provider: "", date: "", total: 0, category: "Other", currency: pol().currency, source: "manual", lineItems: [] });
  }
  recheck();
  claims.forEach((x) => delete x._new);
}

async function handleFiles(files) { for (const f of files) if (f.type.startsWith("image/")) await addImage(f, f.name); }

function renderSamples() {
  $("#samples").innerHTML = sampleList(type).map((s) => `<button data-s="${s.id}">${esc(s.name)}</button>`).join("");
}

function renderType() {
  const P = PROFILES[type];
  document.querySelectorAll("#types button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.t === type)));
  $("#type-note").textContent = `Reads: ${P.doc}. Checks: ${P.params.map((x) => x.label.toLowerCase()).join(", ")}, per-category caps, exclusions, duplicates, arithmetic.`;
  $("#drop-title").textContent = `Drop a document for the ${P.label} desk`;
  renderSamples(); initPolicy(); render();
}

function wire() {
  const drop = $("#drop"), file = $("#file");
  const open = () => file.click();
  drop.addEventListener("click", open);
  drop.addEventListener("keydown", (e) => (e.key === "Enter" || e.key === " ") && open());
  $("#pick").addEventListener("click", (e) => { e.stopPropagation(); open(); });
  file.addEventListener("change", () => { handleFiles(file.files); file.value = ""; });
  ["dragover", "dragenter"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
  drop.addEventListener("drop", (e) => handleFiles(e.dataTransfer.files));

  $("#types").innerHTML = MODE_IDS.map((m) => `<button data-t="${m}" aria-pressed="false">${PROFILES[m].label}</button>`).join("");
  $("#types").addEventListener("click", (e) => { const t = e.target.dataset?.t; if (!t) return; type = t; store.set("cc_type", t); renderType(); });

  $("#samples").addEventListener("click", async (e) => {
    const id = e.target.dataset?.s; if (!id) return;
    Object.assign(pol().params, sampleSetup(type, id)); // e.g. incident date or trip dates that fit the example
    store.set("cc_pol2", policies); initPolicy();
    const { blob, claim } = await renderSample(type, id);
    await addImage(blob, `example "${id}"`, claim);
  });

  $("#claims").addEventListener("change", (e) => {
    const card = e.target.closest(".claim"); if (!card) return;
    const c = claims.find((x) => x.id === card.dataset.id); const f = e.target.dataset.f; if (!c || !f) return;
    c[f] = f === "total" ? Number(e.target.value) : e.target.value;
    recheck();
  });
  $("#claims").addEventListener("click", async (e) => {
    const act = e.target.dataset?.act; const card = e.target.closest(".claim"); if (!act || !card) return;
    const c = claims.find((x) => x.id === card.dataset.id);
    if (act === "rm") { claims = claims.filter((x) => x !== c); recheck(); }
    if (act === "draft") {
      e.target.disabled = true; e.target.textContent = "Drafting…";
      try { const mod = await loadAI(); const r = await mod.draftHandlerNote(c, c.flags, $("#mode").value); c.justification = r.text; log(`Note drafted via ${r.source}.`); }
      catch (err) {
        c.justification = `Hello, to continue your claim we need: ${c.flags.filter((x) => x.severity !== "info").map((x) => x.message.replace(/\.$/, "")).slice(0, 3).join("; ")}. Please reply with the missing details or documents.`;
        log("Live AI is busy, so this note came from a plain template. Edit it freely.", true);
      }
      store.set("cc_claims2", claims); render();
    }
  });

  $("#csv").addEventListener("click", () => {
    const list = mine();
    if (!list.length) return log("Nothing to export yet.", true);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([toCSV(list)], { type: "text/csv" }));
    a.download = `hushmark-${type}-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
  });
  $("#print").addEventListener("click", () => window.print());
  const download = (name, text, mime) => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type: mime })); a.download = name; a.click(); };
  $("#audit").addEventListener("click", () => {
    if (!claims.length) return log("Nothing to export yet.", true);
    download(`hushmark-audit-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(auditJSON(claims, policies), null, 2), "application/json");
  });
  $("#rules-export").addEventListener("click", () => download(`hushmark-rules-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(exportRulePack(policies), null, 2), "application/json"));
  $("#rules-import").addEventListener("click", () => $("#rules-file").click());
  $("#rules-file").addEventListener("change", async (e) => {
    const f = e.target.files[0]; e.target.value = ""; if (!f) return;
    const msg = $("#rules-msg");
    try {
      if (f.size > 200_000) throw new Error("File is too large for a rule pack.");
      const r = parseRulePack(await f.text());
      for (const [k, v] of Object.entries(r.policies)) policies[k] = v;
      store.set("cc_pol2", policies); initPolicy(); recheck();
      msg.textContent = `Imported ${r.applied} settings${r.name ? ` from "${r.name}"` : ""}${r.ignored ? `, ignored ${r.ignored} unknown` : ""}. Cards re-checked.`;
    } catch (err) { msg.textContent = `Not imported: ${String(err.message || err).slice(0, 140)}`; }
  });
  $("#clear").addEventListener("click", () => { if (confirm("Delete all documents and settings stored in this browser?")) { localStorage.clear(); claims = []; for (const m of MODE_IDS) policies[m] = defaultPolicy(m); renderType(); log("All local data deleted."); } });

  $("#mode").value = store.get("cc_mode", "hybrid");
  $("#mode").addEventListener("change", () => { store.set("cc_mode", $("#mode").value); modeNote(); });
  modeNote();
}

function modeNote() {
  $("#mode-note").textContent = {
    private: "Private: documents are read by Gemini Nano in your browser only. If Nano is unavailable the scan fails and you can type the fields. Nothing is uploaded.",
    hybrid: "Hybrid: Gemini Nano first. If this browser has no Nano, the image is sent to Gemini in the cloud through Firebase AI Logic (App Check protected). Each card shows which path ran.",
    cloud: "Cloud only: the image is sent to Gemini through Firebase AI Logic. Use this to compare speed and quality with on-device.",
  }[$("#mode").value];
}

let nanoPoll;
async function nanoStatus() {
  const chip = $("#nano-chip"), btn = $("#nano-dl");
  const st = await nanoState();
  const map = {
    unsupported: ["Gemini Nano: not in this browser (cloud fallback)", "mid"],
    available: ["Gemini Nano: ready on this device", "good"],
    downloadable: ["Gemini Nano: not downloaded yet", "mid"],
    downloading: ["Gemini Nano: downloading…", "mid"],
    unavailable: ["Gemini Nano: not supported on this device (cloud fallback)", "mid"],
    error: ["Gemini Nano: could not be checked (cloud fallback)", "mid"],
  };
  const [t, c] = map[st]; chip.textContent = t; chip.className = `chip ${c}`; chip.dataset.state = st;
  btn.hidden = st !== "downloadable"; btn.disabled = false; btn.textContent = "Download Gemini Nano";
  clearTimeout(nanoPoll);
  if (st === "downloading") nanoPoll = setTimeout(nanoStatus, 3000);
}
$("#nano-dl").addEventListener("click", async (e) => {
  const chip = $("#nano-chip"); e.target.disabled = true;
  try {
    await downloadNano((f) => { chip.textContent = `Gemini Nano: downloading ${Math.round(f * 100)}%`; chip.className = "chip mid"; chip.dataset.state = "downloading"; });
  } catch (err) { log(`Nano download failed: ${String(err?.message || err).slice(0, 100)}. Cloud fallback still works.`, true); }
  nanoStatus();
});

function initPolicy() {
  const P = PROFILES[type], p = pol();
  $("#limits").innerHTML = P.categories.map((k) => `<label>${esc(k)} cap<input type="number" min="0" data-k="${esc(k)}" value="${p.limits[k]}"></label>`).join("");
  $("#params").innerHTML = P.params.map((x) => `<label>${esc(x.label)}<input type="${x.type}" data-p="${x.k}" value="${esc(p.params[x.k] ?? "")}"></label>`).join("");
  $("#pol-title").textContent = `${P.label} rules, editable`;
}
function wirePolicy() {
  const save = () => { store.set("cc_pol2", policies); recheck(); };
  $("#limits").addEventListener("change", (e) => { const k = e.target.dataset.k; if (k) { pol().limits[k] = Number(e.target.value); save(); } });
  $("#params").addEventListener("change", (e) => { const k = e.target.dataset.p; if (k) { pol().params[k] = e.target.type === "number" ? Number(e.target.value) : e.target.value; save(); } });
}

wire(); wirePolicy(); renderType(); recheck(); nanoStatus();

// Scroll reveal, skipped when the user prefers reduced motion.
if (!matchMedia("(prefers-reduced-motion: reduce)").matches && "IntersectionObserver" in window) {
  const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }), { threshold: 0.12 });
  document.querySelectorAll(".desks,.features .feat,.usp > *,.compete > *,.how > *,.biz > *").forEach((el) => { el.classList.add("rv"); io.observe(el); });
}
