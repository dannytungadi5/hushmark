// Deterministic claim pre-check engine for insurance claim documents. Runs fully on the device, no AI involved.
// The AI reads the document. These rules check it. A human claims handler decides.

export const PROFILES = {
  health: {
    id: "health",
    label: "Health",
    doc: "medical invoice, pharmacy bill or lab report",
    party: "Patient",
    reference: "Invoice no.",
    categories: ["Consultation", "Medication", "Lab & imaging", "Hospital room", "Procedure", "Other"],
    limits: { Consultation: 120, Medication: 200, "Lab & imaging": 400, "Hospital room": 900, Procedure: 3000, Other: 150 },
    params: [
      { k: "filingDays", label: "Filing window (days)", type: "number", def: 90 },
      { k: "roomPerDay", label: "Room cap per day", type: "number", def: 150 },
    ],
    excluded: /\b(cosmetic|whitening|botox|filler|lasik|vitamins?|supplements?|slimming|perfume|lipstick)\b/i,
    excludedWhy: "Item is usually excluded from health cover (cosmetic or non-medical).",
  },
  motor: {
    id: "motor",
    label: "Motor",
    doc: "workshop repair invoice, estimate or towing bill",
    party: "Vehicle owner",
    reference: "Plate no.",
    categories: ["Repair invoice", "Towing", "Replacement rental", "Other"],
    limits: { "Repair invoice": 4000, Towing: 250, "Replacement rental": 600, Other: 150 },
    params: [
      { k: "filingDays", label: "Filing window (days)", type: "number", def: 60 },
      { k: "incidentDate", label: "Incident date", type: "date", def: "" },
      { k: "labourMaxPct", label: "Max labour share of invoice (%)", type: "number", def: 55 },
    ],
    excluded: /\b(oil change|servicing|service kit|wipers?|tyres?|tires?|brake pads?|detailing|car wash|accessor(y|ies)|upgrade)\b/i,
    excludedWhy: "Wear, maintenance or upgrade item. Collision cover usually excludes it.",
  },
  travel: {
    id: "travel",
    label: "Travel",
    doc: "medical bill abroad, hotel, transport or baggage receipt",
    party: "Traveller",
    reference: "Booking / policy ref.",
    categories: ["Medical abroad", "Transport & delay", "Hotel", "Baggage", "Other"],
    limits: { "Medical abroad": 5000, "Transport & delay": 400, Hotel: 300, Baggage: 500, Other: 150 },
    params: [
      { k: "filingDays", label: "Filing window (days)", type: "number", def: 60 },
      { k: "tripStart", label: "Trip start", type: "date", def: "" },
      { k: "tripEnd", label: "Trip end", type: "date", def: "" },
    ],
    excluded: /\b(alcohol|beer|wine|cocktails?|souvenirs?|gifts?|duty.?free|spa|casino|cigarettes?)\b/i,
    excludedWhy: "Item is normally not covered (alcohol, gifts, leisure).",
  },
  expenses: {
    id: "expenses",
    label: "Expenses",
    doc: "receipt or invoice for an office reimbursement claim",
    party: "Employee",
    reference: "Receipt no.",
    categories: ["Meals", "Transport", "Lodging", "Office", "Software", "Other"],
    limits: { Meals: 60, Transport: 80, Lodging: 220, Office: 150, Software: 200, Other: 100 },
    params: [
      { k: "filingDays", label: "Filing window (days)", type: "number", def: 30 },
      { k: "taxAbove", label: "Require tax line above", type: "number", def: 25 },
    ],
    excluded: /\b(beer|wine|vodka|whisk(e)?y|gin|rum|sake|cocktails?|liquor|lager|ipa|bir|cigarettes?|gifts?)\b/i,
    excludedWhy: "Alcohol, tobacco or gifts are not reimbursed under most policies.",
  },
};
export const MODE_IDS = Object.keys(PROFILES);

export function defaultPolicy(mode) {
  const p = PROFILES[mode];
  return { currency: "USD", limits: { ...p.limits }, params: Object.fromEntries(p.params.map((x) => [x.k, x.def])) };
}

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

export function fingerprint(c) {
  return `${norm(c.provider)}|${norm(c.reference)}|${c.date || ""}|${Number(c.total || 0).toFixed(2)}`;
}

export function daysBetween(isoA, isoB) {
  const a = Date.parse(isoA), b = Date.parse(isoB);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.floor((b - a) / 86400000);
}

/** Returns an array of {code, severity, message}. severity: "block" | "warn". */
export function checkClaim(claim, all = [], policy, mode = claim.mode || "health", today = new Date().toISOString().slice(0, 10)) {
  const prof = PROFILES[mode];
  policy ||= defaultPolicy(mode);
  const P = policy.params || {};
  const flags = [];
  const add = (code, severity, message) => flags.push({ code, severity, message });
  const same = all.filter((o) => o.id !== claim.id && (o.mode || mode) === mode);
  const total = Number(claim.total) || 0;
  const lines = claim.lineItems || [];

  if (!claim.provider) add("no-provider", "block", "Provider or issuer name is missing.");
  if (!(total > 0)) add("no-total", "block", "Total amount is missing or zero.");
  if (!claim.date || Number.isNaN(Date.parse(claim.date))) add("no-date", "block", "Document date is missing or unreadable.");
  else {
    const age = daysBetween(claim.date, today);
    if (age !== null && age < 0) add("future-date", "block", "Document date is in the future.");
    if (age !== null && P.filingDays && age > P.filingDays) add("stale", "warn", `Document is ${age} days old. Filing window is ${P.filingDays} days.`);
  }
  if (!claim.party) add("no-party", "warn", `${prof.party} name is missing. The handler cannot match this document to the insured.`);
  if (!claim.reference) add("no-reference", "warn", `${prof.reference} is missing.`);

  const cap = policy.limits?.[claim.category];
  if (cap && total > cap) add("over-cap", "warn", `${claim.category} cap is ${cap} ${policy.currency}; this document is ${total.toFixed(2)}.`);

  if (lines.length) {
    const sum = lines.reduce((s, l) => s + Number(l.amount || 0), 0);
    const expected = sum + Number(claim.tax || 0);
    if (sum > 0 && Math.abs(expected - total) > Math.max(0.5, total * 0.03))
      add("math", "warn", `Line items + tax = ${expected.toFixed(2)} but the total reads ${total.toFixed(2)}. Check the scan or the document.`);
    for (const hit of lines.filter((l) => prof.excluded.test(l.description || ""))) add("excluded", "warn", `"${hit.description}": ${prof.excludedWhy}`);
  } else if (total > 100) {
    add("no-lines", "warn", "No itemised lines. Ask for an itemised document before paying.");
  }

  if (mode === "health") {
    const room = lines.find((l) => /\b(room|ward|bed|accommodation)\b/i.test(l.description || "") && P.roomPerDay && Number(l.amount) > P.roomPerDay * 1.0001 && !/\bx\s*\d|\b\d+\s*(nights?|days?)\b/i.test(l.description));
    if (room) add("room-cap", "warn", `Room line ${Number(room.amount).toFixed(2)} is above the plan cap of ${P.roomPerDay} per day. Check the number of days.`);
    const other = same.find((o) => o.party && claim.party && norm(o.party) !== norm(claim.party));
    if (other) add("party-mismatch", "warn", `Another document in this claim names a different patient ("${other.party}").`);
  }
  if (mode === "motor") {
    if (P.incidentDate && claim.date && claim.date < P.incidentDate) add("before-incident", "block", `Document is dated ${claim.date}, before the reported incident (${P.incidentDate}).`);
    const labour = lines.filter((l) => /\b(labou?r|workmanship|work)\b/i.test(l.description || "")).reduce((s, l) => s + Number(l.amount || 0), 0);
    if (total > 0 && P.labourMaxPct && labour / total * 100 > P.labourMaxPct) add("labour-share", "warn", `Labour is ${Math.round(labour / total * 100)}% of the invoice (limit ${P.labourMaxPct}%). Ask for a parts breakdown.`);
    const other = same.find((o) => o.reference && claim.reference && norm(o.reference) !== norm(claim.reference));
    if (other) add("plate-mismatch", "warn", `Another document in this claim shows a different plate ("${other.reference}").`);
  }
  if (mode === "expenses") {
    if (P.taxAbove && claim.tax == null && total > P.taxAbove) add("no-tax", "warn", `No tax line found on a receipt above ${P.taxAbove}.`);
  }
  if (mode === "travel") {
    if (P.tripStart && claim.date && claim.date < P.tripStart) add("before-trip", "warn", `Document is dated before the trip started (${P.tripStart}).`);
    if (P.tripEnd && claim.date && claim.date > P.tripEnd) add("after-trip", "warn", `Document is dated after the trip ended (${P.tripEnd}).`);
    if (claim.category === "Medical abroad" && !claim.party) add("medical-party", "block", "A medical bill abroad must name the traveller who was treated.");
  }

  if (same.some((o) => fingerprint(o) === fingerprint(claim))) add("duplicate", "block", "Same provider, reference, date and total already in this claim.");
  if (total >= 50 && total % 10 === 0 && !lines.length) add("round", "warn", "Round total with no line items. Confirm it is a genuine document.");
  if (claim.confidence != null && claim.confidence < 0.6) add("low-confidence", "warn", "The model was unsure about this scan. Review the fields against the image.");
  return flags;
}

export function summarize(claims, currency = "USD") {
  let total = 0, blocked = 0, warned = 0;
  for (const c of claims) {
    total += Number(c.total) || 0;
    const f = c.flags || [];
    if (f.some((x) => x.severity === "block")) blocked++;
    else if (f.length) warned++;
  }
  return { count: claims.length, total, blocked, warned, clean: claims.length - blocked - warned, currency };
}

export function toCSV(claims) {
  const esc = (s) => `"${String(s ?? "").replace(/"/g, '""')}"`;
  const head = ["claim_type", "provider", "reference", "party", "date", "category", "currency", "total", "tax", "precheck_status", "findings", "note"];
  const rows = claims.map((c) => {
    const f = c.flags || [];
    const status = f.some((x) => x.severity === "block") ? "HOLD" : f.length ? "REVIEW" : "CLEAR";
    return [c.mode, c.provider, c.reference, c.party, c.date, c.category, c.currency, Number(c.total || 0).toFixed(2), c.tax ?? "", status, f.map((x) => x.message).join(" | "), c.justification || ""].map(esc).join(",");
  });
  return [head.join(","), ...rows].join("\n");
}

// ---- Rule packs and audit export -------------------------------------------------------------

/** A rule pack is the editable part of the rules (caps and parameters per claim type) as a small JSON file. */
export function exportRulePack(policies, name = "My rule pack") {
  const rules = {};
  for (const m of Object.keys(PROFILES)) if (policies[m]) rules[m] = { currency: policies[m].currency, limits: { ...policies[m].limits }, params: { ...policies[m].params } };
  return { format: "hushmark-rules", version: 1, name, exportedAt: new Date().toISOString(), rules };
}

/** Validate a rule pack from text. Only known claim types, categories and parameters are accepted; the rest is counted and ignored. */
export function parseRulePack(text) {
  let o; try { o = JSON.parse(text); } catch { throw new Error("That file is not valid JSON."); }
  if (!o || o.format !== "hushmark-rules" || o.version !== 1 || typeof o.rules !== "object") throw new Error("Not a Hushmark rule pack (format hushmark-rules, version 1).");
  const out = {}; let ignored = 0, applied = 0;
  for (const [m, r] of Object.entries(o.rules || {})) {
    const P = PROFILES[m]; if (!P || !r || typeof r !== "object") { ignored++; continue; }
    const d = defaultPolicy(m);
    if (r.currency !== undefined) { if (/^[A-Z]{3}$/.test(String(r.currency))) { d.currency = r.currency; applied++; } else throw new Error(`${P.label}: currency must be a 3-letter code.`); }
    for (const [k, v] of Object.entries(r.limits || {})) {
      if (!(k in P.limits)) { ignored++; continue; }
      if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1e9) throw new Error(`${P.label}: cap "${k}" must be a number from 0.`);
      d.limits[k] = v; applied++;
    }
    for (const [k, v] of Object.entries(r.params || {})) {
      const def = P.params.find((x) => x.k === k); if (!def) { ignored++; continue; }
      if (def.type === "number") { if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1e9) throw new Error(`${P.label}: "${def.label}" must be a number from 0.`); }
      else if (v !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(String(v))) throw new Error(`${P.label}: "${def.label}" must be a date (YYYY-MM-DD) or empty.`);
      d.params[k] = v; applied++;
    }
    out[m] = d;
  }
  if (!Object.keys(out).length) throw new Error("The rule pack has no known claim types.");
  return { policies: out, applied, ignored, name: String(o.name || "").slice(0, 80) };
}

/** Audit trail: what was read, by which path, which rules were active, and what was flagged. A human still decides. */
export function auditJSON(claims, policies, generatedAt = new Date().toISOString()) {
  const status = (f) => (f.some((x) => x.severity === "block") ? "HOLD" : f.length ? "REVIEW" : "CLEAR");
  return {
    format: "hushmark-audit", version: 1, generatedAt,
    notice: "Pre-check output for a claims handler. It flags document problems and never decides a claim or detects fraud.",
    rules: exportRulePack(policies, "Rules in force").rules,
    documents: claims.map((c) => ({
      type: c.mode, provider: c.provider, reference: c.reference, party: c.party, date: c.date, category: c.category, currency: c.currency,
      total: Number(c.total || 0), tax: c.tax ?? null, read_by: c.source || "manual", read_note: c.note || "",
      precheck_status: status(c.flags || []), findings: (c.flags || []).map((x) => ({ code: x.code, severity: x.severity, message: x.message })),
      handler_note: c.justification || "",
    })),
  };
}
