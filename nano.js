// Gemini Nano (Chrome Prompt API) helpers. Follows developer.chrome.com/docs/ai/prompt-api:
// the SAME options go to availability(), create() and prompt() (Firebase AI Logic passes createOptions to all three).
export const NANO_OPTS = {
  expectedInputs: [{ type: "text", languages: ["en"] }, { type: "image" }],
  expectedOutputs: [{ type: "text", languages: ["en"] }],
};
export const nanoOpts = () => JSON.parse(JSON.stringify(NANO_OPTS));

/** Hard limit for one on-device attempt. A test can shorten it with localStorage hm_nano_timeout (ms). */
export const nanoTimeoutMs = () => Number(localStorage.getItem("hm_nano_timeout")) || 45000;

/** "unsupported" (no API) | "available" | "downloadable" | "downloading" | "unavailable" | "error" */
export async function nanoState() {
  const LM = self.LanguageModel;
  if (!LM || typeof LM.availability !== "function") return "unsupported";
  try {
    const a = await LM.availability(nanoOpts());
    return ["available", "downloadable", "downloading", "unavailable"].includes(a) ? a : "error";
  } catch { return "error"; }
}

/** Start the model download. Must run inside a user gesture (click): Chrome needs user activation for create(). */
export async function downloadNano(onProgress = () => {}) {
  const LM = self.LanguageModel;
  if (!LM) throw new Error("This browser has no Prompt API.");
  const session = await LM.create({
    ...nanoOpts(),
    monitor(m) { m.addEventListener("downloadprogress", (e) => onProgress(Math.max(0, Math.min(1, Number(e.loaded) || 0)))); },
  });
  try { session.destroy?.(); } catch { /* ignore */ }
  return nanoState();
}

export function withTimeout(promise, ms, label = "On-device read") {
  let t;
  const timer = new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms); });
  return Promise.race([promise, timer]).finally(() => clearTimeout(t));
}

/** A Nano answer must be usable before we show it; otherwise we fall back. */
export function validateClaim(c) {
  if (!c || typeof c !== "object") throw new Error("Nano returned no fields");
  if (!Number.isFinite(Number(c.total)) || Number(c.total) <= 0) throw new Error("Nano returned no usable total");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(c.date || ""))) throw new Error("Nano returned no usable date");
  if (!String(c.provider || "").trim()) throw new Error("Nano returned no provider");
  return c;
}

export const NANO_REASON = {
  unsupported: "This browser has no Gemini Nano (Prompt API).",
  unavailable: "This device cannot run Gemini Nano.",
  downloadable: "Gemini Nano is not downloaded yet. Use the Download button first.",
  downloading: "Gemini Nano is still downloading.",
  error: "Gemini Nano could not be checked.",
};
