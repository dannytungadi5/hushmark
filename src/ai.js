// Firebase AI Logic hybrid inference: Gemini Nano on-device (Chrome) with Gemini cloud fallback.
import { initializeApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "firebase/app-check";
import { getAI, getGenerativeModel, GoogleAIBackend, InferenceMode, Schema } from "firebase/ai";
import { firebaseConfig, APP_CHECK_SITE_KEY, CLOUD_MODEL, MODEL_CHAIN } from "./firebase-config.js";
import { PROFILES } from "./policy.js";
import { nanoOpts, nanoState, nanoTimeoutMs, withTimeout, validateClaim, NANO_REASON } from "./nano.js";

let app, ai;
function boot() {
  if (ai) return ai;
  // Optional debug token for local runs and judge testing (see README, "Testing").
  // Set VITE_APPCHECK_DEBUG_TOKEN in .env.local, or run localStorage.setItem("cc_appcheck_debug", "<token>") in the console.
  const dbg = import.meta.env.VITE_APPCHECK_DEBUG_TOKEN || localStorage.getItem("cc_appcheck_debug");
  if (dbg) self.FIREBASE_APPCHECK_DEBUG_TOKEN = dbg;
  app = initializeApp(firebaseConfig);
  initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(APP_CHECK_SITE_KEY), isTokenAutoRefreshEnabled: true });
  ai = getAI(app, { backend: new GoogleAIBackend() });
  return ai;
}

const schemaFor = (mode) => Schema.object({
  properties: {
    provider: Schema.string({ description: "Issuer: clinic, hospital, pharmacy, workshop, hotel or airline" }),
    reference: Schema.string({ description: `${PROFILES[mode].reference} as printed on the document` }),
    party: Schema.string({ description: `${PROFILES[mode].party} name as printed` }),
    date: Schema.string({ description: "ISO date YYYY-MM-DD" }),
    currency: Schema.string({ description: "ISO 4217 code, e.g. USD, IDR" }),
    total: Schema.number(),
    tax: Schema.number({ nullable: true }),
    category: Schema.enumString({ enum: PROFILES[mode].categories }),
    confidence: Schema.number({ description: "0 to 1, how sure you are the fields are right" }),
    lineItems: Schema.array({ items: Schema.object({ properties: { description: Schema.string(), amount: Schema.number() } }) }),
  },
  optionalProperties: ["tax", "lineItems", "confidence", "reference", "party"],
});

// Plain JSON Schema for the Chrome Prompt API responseConstraint (Firebase's Schema.toJSON uses another dialect).
const jsonSchemaFor = (mode) => ({
  type: "object",
  properties: {
    provider: { type: "string" }, reference: { type: "string" }, party: { type: "string" }, date: { type: "string" },
    currency: { type: "string" }, total: { type: "number" }, tax: { type: ["number", "null"] },
    category: { type: "string", enum: PROFILES[mode].categories }, confidence: { type: "number" },
    lineItems: { type: "array", items: { type: "object", properties: { description: { type: "string" }, amount: { type: "number" } }, required: ["description", "amount"] } },
  },
  required: ["provider", "date", "currency", "total", "category"],
});
const FALLBACK_MODELS = MODEL_CHAIN;
const MODES = {
  private: InferenceMode.ONLY_ON_DEVICE,   // nothing leaves the device
  hybrid: InferenceMode.PREFER_ON_DEVICE,   // device first, cloud fallback
  cloud: InferenceMode.ONLY_IN_CLOUD,
};

function model(modeKey, json, claimMode = "health", cloudModel = CLOUD_MODEL) {
  const generationConfig = json ? { responseMimeType: "application/json", responseSchema: schemaFor(claimMode), temperature: 0.1 } : { temperature: 0.4 };
  return getGenerativeModel(boot(), {
    mode: MODES[modeKey],
    onDeviceParams: {
      createOptions: nanoOpts(), // same options as LanguageModel.availability() in nano.js
      promptOptions: json ? { responseConstraint: jsonSchemaFor(claimMode) } : undefined,
    },
    inCloudParams: { model: cloudModel, generationConfig },
  }, { timeout: 40000 });
}

export const onDeviceStatus = nanoState;

async function withRetry(fn, tries = 3, base = 2500) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); } catch (e) {
      last = e;
      const msg = String(e?.message || e);
      if (!/429|quota|RESOURCE_EXHAUSTED|503|overloaded/i.test(msg)) throw e;
      await new Promise((r) => setTimeout(r, base * (i + 1)));
    }
  }
  throw last;
}

const promptFor = (mode) => `You read a photo of an insurance claim document: a ${PROFILES[mode].doc}.
Return JSON only. Fields: provider, reference (${PROFILES[mode].reference}), party (${PROFILES[mode].party}), date (YYYY-MM-DD), currency (ISO code), total (number, final amount billed), tax (number or null), category (one of ${PROFILES[mode].categories.join(", ")}), confidence (0-1), lineItems (REQUIRED: description and amount for every printed line, do not skip lines).
party: copy the person named on the document exactly as printed (a NAME, NAMA, PATIENT, INSURED, DRIVER or TRAVELLER line counts). Leave party out only when no person name is printed. If another field is not visible, omit it. Never invent values. Do not judge whether the claim should be paid.`;

/** Cloud chain: each model is tried in order (quota is per model), always ONLY_IN_CLOUD. */
async function cloudChain(parts, claimMode) {
  let res, last;
  for (const cm of FALLBACK_MODELS) {
    try {
      const m = model("cloud", true, claimMode, cm);
      res = await withRetry(() => m.generateContent(parts), 2, 1500);
      break;
    } catch (e) { last = e; if (!/429|quota|RESOURCE_EXHAUSTED|503|overloaded|not found|404|timed? ?out|abort/i.test(String(e?.message || e))) throw e; }
  }
  if (!res) throw last;
  return res;
}

/**
 * Extract a claim from an image Blob. Returns {claim, source, note}. source: "on-device" | "in-cloud".
 * Private: Nano only, clear error if it cannot run. Hybrid: Nano if the model is ready, and ANY error,
 * timeout, empty or invalid answer falls back to the cloud chain (note says why). Cloud: cloud only.
 */
export async function extractDocument(blob, modeKey = "hybrid", claimMode = "health", onStatus = () => {}) {
  const data = await blobToBase64(await shrink(blob)); // smaller image = fewer tokens, faster, less quota
  const parts = [promptFor(claimMode), { inlineData: { mimeType: blob.type || "image/jpeg", data } }];
  let note = "";
  if (modeKey !== "cloud") {
    const st = await nanoState();
    if (st === "available") {
      onStatus("Reading on this device with Gemini Nano…");
      try {
        const m = model(modeKey === "private" ? "private" : "hybrid", true, claimMode);
        const res = await withTimeout(m.generateContent(parts), nanoTimeoutMs());
        const text = res.response.text();
        const claim = parseJSON(text, claimMode);
        const source = res.response.inferenceSource === "on_device" ? "on-device" : "in-cloud";
        if (source === "on-device") validateClaim(claim);
        return { claim, source, note: "" };
      } catch (e) {
        const why = String(e?.message || e).slice(0, 90);
        if (modeKey === "private") throw new Error(`On-device read failed (${why}). Private mode never uses the cloud.`);
        note = `Nano did not give a usable answer (${why}). Used the cloud instead.`;
        onStatus("Gemini Nano did not finish. Switching to the cloud…");
      }
    } else if (modeKey === "private") {
      throw new Error(`${NANO_REASON[st] || NANO_REASON.error} Private mode never uses the cloud.`);
    } else {
      note = `${NANO_REASON[st] || NANO_REASON.error} Used the cloud instead.`;
    }
  }
  onStatus("Reading in the cloud with Gemini…");
  const res = await cloudChain(parts, claimMode);
  return { claim: parseJSON(res.response.text(), claimMode), source: "in-cloud", note };
}

/** Draft a short, neutral note for the handler (text only). Same order: Nano if ready, else cloud. */
export async function draftHandlerNote(claim, flags, modeKey = "hybrid") {
  const prompt = `Write a short neutral note (max 40 words) from a claims handler to a claimant, asking for what is needed to continue. Use only the findings below. Do not accuse anyone, do not decide the claim, do not invent facts.
Document: ${claim.provider}, ${claim.date}, ${claim.total} ${claim.currency}. Findings: ${flags.map((f) => f.message).join(" ")}`;
  const clean = (r) => ({ text: r.response.text().trim().replace(/^"|"$/g, ""), source: r.response.inferenceSource === "on_device" ? "on-device" : "in-cloud" });
  if (modeKey !== "cloud" && (await nanoState()) === "available") {
    try {
      const r = await withTimeout(model(modeKey === "private" ? "private" : "hybrid", false).generateContent(prompt), nanoTimeoutMs(), "On-device note");
      const out = clean(r); if (out.text.length > 5) return out;
    } catch (e) { if (modeKey === "private") throw e; }
  } else if (modeKey === "private") throw new Error("Private mode needs Gemini Nano on this device, and it is not ready.");
  const r = await withRetry(() => model("cloud", false).generateContent(prompt));
  return clean(r);
}

function parseJSON(t, mode) {
  const s = t.indexOf("{"), e = t.lastIndexOf("}");
  if (s < 0 || e < 0) throw new Error("The model did not return JSON. Try again or enter the fields by hand.");
  const o = JSON.parse(t.slice(s, e + 1));
  o.total = Number(o.total); if (o.tax != null) o.tax = Number(o.tax);
  if (!PROFILES[mode].categories.includes(o.category)) o.category = "Other";
  o.lineItems = Array.isArray(o.lineItems) ? o.lineItems.map((l) => ({ description: String(l.description || ""), amount: Number(l.amount || 0) })) : [];
  return o;
}

function blobToBase64(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(",")[1]);
    r.onerror = rej;
    r.readAsDataURL(blob);
  });
}

/** Downscale to max 1024px on the long side, JPEG 0.85. Receipts stay readable; tokens and upload size drop. */
async function shrink(blob, max = 1024) {
  try {
    const bmp = await createImageBitmap(blob);
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    if (k === 1 && blob.size < 400_000) return blob;
    const c = document.createElement("canvas"); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    return await new Promise((r) => c.toBlob((b) => r(b || blob), "image/jpeg", 0.85));
  } catch { return blob; }
}
