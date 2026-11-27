import assert from "node:assert/strict";
import { checkClaim, summarize, toCSV, fingerprint, defaultPolicy, PROFILES, exportRulePack, parseRulePack, auditJSON } from "../src/policy.js";
const today = "2026-11-27";
const has = (f, code) => f.some((x) => x.code === code);
const H = { id: "1", mode: "health", provider: "Klinik Sehat", reference: "INV-1", party: "Budi", date: "2026-11-18", total: 79.5, category: "Consultation", currency: "USD", lineItems: [{ description: "Consultation", amount: 45 }, { description: "Blood test", amount: 28 }, { description: "Paracetamol", amount: 6.5 }] };
const pol = (m, over = {}) => { const p = defaultPolicy(m); p.params = { ...p.params, ...over }; return p; };
// health
assert.deepEqual(checkClaim(H, [H], pol("health"), "health", today), []);
assert.ok(has(checkClaim({ ...H, date: "2026-07-01" }, [], pol("health"), "health", today), "stale"));
assert.ok(has(checkClaim({ ...H, lineItems: [...H.lineItems, { description: "Vitamin C infusion", amount: 0 }] }, [], pol("health"), "health", today), "excluded"));
assert.ok(has(checkClaim({ ...H, lineItems: [{ description: "Room, private ward", amount: 540 }], total: 540, category: "Hospital room" }, [], pol("health"), "health", today), "room-cap"));
assert.ok(!has(checkClaim({ ...H, lineItems: [{ description: "Room x 3 nights", amount: 400 }], total: 400, category: "Hospital room" }, [], pol("health"), "health", today), "room-cap"));
assert.ok(has(checkClaim({ ...H, party: "" }, [], pol("health"), "health", today), "no-party"));
assert.ok(has(checkClaim(H, [H, { ...H, id: "2", party: "Sinta", reference: "INV-2" }], pol("health"), "health", today), "party-mismatch"));
const dup = { ...H, id: "2" };
assert.ok(has(checkClaim(dup, [H, dup], pol("health"), "health", today), "duplicate"));
assert.equal(fingerprint(H), fingerprint(dup));
// claims of another type never count as duplicates
assert.ok(!has(checkClaim(dup, [{ ...dup, id: "3", mode: "motor" }], pol("health"), "health", today), "duplicate"));
assert.ok(has(checkClaim({ ...H, total: 120 }, [], pol("health"), "health", today), "math"));
assert.ok(has(checkClaim({ ...H, confidence: 0.3 }, [], pol("health"), "health", today), "low-confidence"));
assert.ok(has(checkClaim({ ...H, provider: "" }, [], pol("health"), "health", today), "no-provider"));
// motor
const M = { id: "m1", mode: "motor", provider: "Bengkel", reference: "B 1234 XYZ", party: "Dewi", date: "2026-11-21", total: 720, category: "Repair invoice", currency: "USD", lineItems: [{ description: "Bumper (part)", amount: 310 }, { description: "Paint and body", amount: 260 }, { description: "Labour 6h", amount: 150 }] };
const mp = pol("motor", { incidentDate: "2026-11-15" });
assert.deepEqual(checkClaim(M, [M], mp, "motor", today), []);
assert.ok(has(checkClaim({ ...M, date: "2026-11-01" }, [], mp, "motor", today), "before-incident"));
assert.ok(has(checkClaim({ ...M, lineItems: [{ description: "Labour 14h", amount: 600 }, { description: "Door", amount: 120 }] }, [], mp, "motor", today), "labour-share"));
assert.ok(has(checkClaim({ ...M, lineItems: [...M.lineItems, { description: "Oil change", amount: 0 }] }, [], mp, "motor", today), "excluded"));
assert.ok(has(checkClaim(M, [M, { ...M, id: "m2", reference: "B 9 AA", total: 5 }], mp, "motor", today), "plate-mismatch"));
// travel
const T = { id: "t1", mode: "travel", provider: "Bangkok Care", reference: "TRV-1", party: "Sari", date: "2026-11-19", total: 147, category: "Medical abroad", currency: "USD", lineItems: [{ description: "Consultation", amount: 60 }, { description: "IV fluids", amount: 55 }, { description: "Medication", amount: 32 }] };
const tp = pol("travel", { tripStart: "2026-11-13", tripEnd: "2026-11-23" });
assert.deepEqual(checkClaim(T, [T], tp, "travel", today), []);
assert.ok(has(checkClaim({ ...T, date: "2026-11-05" }, [], tp, "travel", today), "before-trip"));
assert.ok(has(checkClaim({ ...T, date: "2026-11-25" }, [], tp, "travel", today), "after-trip"));
assert.ok(has(checkClaim({ ...T, lineItems: [...T.lineItems, { description: "Souvenir shop", amount: 0 }] }, [], tp, "travel", today), "excluded"));
assert.ok(checkClaim({ ...T, party: "" }, [], tp, "travel", today).some((f) => f.severity === "block"));
// expenses
const E = { id: "e1", mode: "expenses", provider: "Kopi Kenangan", reference: "R-1", party: "Rina", date: "2026-11-22", total: 21.67, tax: 1.97, category: "Meals", currency: "USD", lineItems: [{ description: "Latte", amount: 9 }, { description: "Sandwich", amount: 7.5 }, { description: "Brownie", amount: 3.2 }] };
const ep = pol("expenses");
assert.deepEqual(checkClaim(E, [E], ep, "expenses", today), []);
assert.ok(has(checkClaim({ ...E, lineItems: [{ description: "Draft beer x4", amount: 19.7 }], tax: 0 }, [], ep, "expenses", today), "excluded"));
assert.ok(has(checkClaim({ ...E, total: 84, tax: null, lineItems: [{ description: "Fish", amount: 84 }], category: "Meals" }, [], ep, "expenses", today), "over-cap"));
assert.ok(has(checkClaim({ ...E, total: 40, tax: null, lineItems: [{ description: "Fish", amount: 40 }] }, [], ep, "expenses", today), "no-tax"));
// summary + csv
const s = summarize([{ ...H, flags: [] }, { ...H, flags: [{ severity: "block" }] }, { ...H, flags: [{ severity: "warn" }] }]);
assert.equal(s.count, 3); assert.equal(s.blocked, 1); assert.equal(s.warned, 1); assert.equal(s.clean, 1);
assert.match(toCSV([{ ...H, flags: [] }]), /Klinik Sehat.*CLEAR/);
assert.equal(Object.keys(PROFILES).length, 4);
// rule packs
const allPol = Object.fromEntries(Object.keys(PROFILES).map((m) => [m, defaultPolicy(m)]));
allPol.health.limits.Consultation = 99; allPol.motor.params.filingDays = 30;
const pack = exportRulePack(allPol, "Test pack");
const back = parseRulePack(JSON.stringify(pack));
assert.equal(back.policies.health.limits.Consultation, 99); assert.equal(back.policies.motor.params.filingDays, 30); assert.equal(back.ignored, 0);
assert.throws(() => parseRulePack("nope"), /valid JSON/);
assert.throws(() => parseRulePack(JSON.stringify({ format: "other" })), /Not a Hushmark/);
assert.throws(() => parseRulePack(JSON.stringify({ format: "hushmark-rules", version: 1, rules: { health: { limits: { Consultation: -5 } } } })), /number from 0/);
assert.throws(() => parseRulePack(JSON.stringify({ format: "hushmark-rules", version: 1, rules: { health: { limits: { Consultation: "9" } } } })), /number from 0/);
assert.throws(() => parseRulePack(JSON.stringify({ format: "hushmark-rules", version: 1, rules: { health: { params: { filingDays: 1e12 } } } })), /number from 0/);
const odd = parseRulePack(JSON.stringify({ format: "hushmark-rules", version: 1, rules: { health: { limits: { Consultation: 10, Bogus: 5 }, evil: 1 }, spaceship: {} } }));
assert.equal(odd.policies.health.limits.Consultation, 10); assert.equal(odd.ignored, 2); assert.ok(!("spaceship" in odd.policies));
assert.throws(() => parseRulePack(JSON.stringify({ format: "hushmark-rules", version: 1, rules: { spaceship: {} } })), /no known claim types/);
// audit trail
const aud = auditJSON([{ ...H, source: "in-cloud", note: "x", flags: [{ code: "stale", severity: "warn", message: "Old." }] }], allPol, "2026-11-27T00:00:00.000Z");
assert.equal(aud.documents[0].precheck_status, "REVIEW"); assert.equal(aud.documents[0].read_by, "in-cloud"); assert.equal(aud.documents[0].findings[0].code, "stale");
assert.match(aud.notice, /never decides/); assert.equal(aud.rules.health.limits.Consultation, 99);
console.log("policy tests passed");
