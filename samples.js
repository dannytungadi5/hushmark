// Draws synthetic claim documents on a canvas so anyone can try the app with no personal data.
// d = day offset from today. `case` params are applied to the policy when empty, so the example is coherent.
export const SAMPLES = {
  health: [
    { id: "h-clinic", cat: "Consultation", name: "Clinic visit (clean)", title: "Klinik Sehat Sentosa", sub: "Dr. Rina Wulandari, GP", ref: "INV-20418", party: "Budi Santoso", d: -9,
      lines: [["Consultation", 45], ["Blood test (CBC)", 28], ["Paracetamol 500mg x20", 6.5]], tax: 0 },
    { id: "h-hospital", cat: "Hospital room", name: "Hospital bill (flagged)", title: "RS Harapan Bunda", sub: "Inpatient, 3 nights", ref: "IP-77310", party: "Budi Santoso", d: -34,
      lines: [["Room, private ward", 540], ["Surgeon fee", 800], ["Vitamin C infusion", 65], ["Whitening kit", 40], ["Lab & imaging", 210]], tax: 0 },
  ],
  motor: [
    { id: "m-bumper", cat: "Repair invoice", name: "Bumper repair (clean)", title: "Bengkel Jaya Motor", sub: "Authorised workshop", ref: "B 1234 XYZ", party: "Dewi Lestari", d: -6,
      lines: [["Front bumper (part)", 310], ["Paint and body", 260], ["Labour 6h", 150]], tax: 0, setup: { incidentDate: -12 } },
    { id: "m-late", cat: "Repair invoice", name: "Invoice before incident (held)", title: "Auto Prima Garage", sub: "Repair invoice", ref: "B 1234 XYZ", party: "Dewi Lestari", d: -30,
      lines: [["Labour 14h", 420], ["Door panel (part)", 180], ["Oil change", 35], ["Wiper blades", 18]], tax: 0, setup: { incidentDate: -12 } },
  ],
  travel: [
    { id: "t-clinic", cat: "Medical abroad", name: "Clinic abroad (clean)", title: "Bangkok Care Clinic", sub: "Outpatient, Bangkok", ref: "TRV-55102", party: "Sari Putri", d: -8,
      lines: [["Consultation", 60], ["IV fluids", 55], ["Medication", 32]], tax: 0, setup: { tripStart: -14, tripEnd: -4 } },
    { id: "t-hotel", cat: "Hotel", name: "Hotel and gifts (flagged)", title: "Lotus Bay Hotel", sub: "Delayed flight, extra night", ref: "TRV-55102", party: "Sari Putri", d: -2,
      lines: [["Room, 1 night", 190], ["Minibar wine", 28], ["Souvenir shop", 45]], tax: 0, setup: { tripStart: -14, tripEnd: -4 } },
  ],
  expenses: [
    { id: "e-lunch", cat: "Meals", name: "Team lunch (clean)", title: "Kopi Kenangan Senopati", sub: "Cafe, Jakarta", ref: "R-30412", party: "Rina Putri", d: -5,
      lines: [["Iced latte x2", 9.0], ["Chicken sandwich", 7.5], ["Brownie", 3.2]], tax: 1.97 },
    { id: "e-dinner", cat: "Meals", name: "Team dinner (flagged)", title: "Sunset Grill", sub: "Restaurant, Bali", ref: "R-88120", party: "Rina Putri", d: -41,
      lines: [["Grilled fish x3", 54.0], ["Draft beer x4", 24.0], ["Rice x3", 6.0]], tax: 0 },
  ],
};

export const sampleList = (mode) => SAMPLES[mode].map((s) => ({ id: s.id, name: s.name }));
const iso = (off) => { const d = new Date(); d.setDate(d.getDate() + off); return d.toISOString().slice(0, 10); };

export function sampleSetup(mode, id) {
  const s = SAMPLES[mode].find((x) => x.id === id);
  return Object.fromEntries(Object.entries(s.setup || {}).map(([k, v]) => [k, iso(v)]));
}

export async function renderSample(mode, id) {
  const s = SAMPLES[mode].find((x) => x.id === id);
  const date = iso(s.d);
  const sub = s.lines.reduce((a, l) => a + l[1], 0);
  const tax = s.tax || 0;
  const W = 520, H = 400 + s.lines.length * 44 + 160;
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const g = c.getContext("2d");
  g.fillStyle = "#fbfaf4"; g.fillRect(0, 0, W, H);
  g.fillStyle = "#1b1b18"; g.textAlign = "center";
  g.font = "bold 28px 'Courier New', monospace"; g.fillText(s.title.toUpperCase(), W / 2, 66);
  g.font = "20px 'Courier New', monospace"; g.fillText(s.sub, W / 2, 98);
  g.fillText(`DATE: ${date}`, W / 2, 130);
  g.textAlign = "left";
  g.fillText(`REF: ${s.ref}`, 30, 170);
  g.fillText(`NAME: ${s.party}`, 30, 200);
  g.fillText("-".repeat(36), 30, 230);
  let y = 270;
  for (const [n, a] of s.lines) { g.fillText(n, 30, y); g.textAlign = "right"; g.fillText(a.toFixed(2), W - 30, y); g.textAlign = "left"; y += 44; }
  g.fillText("-".repeat(36), 30, y); y += 40;
  if (tax) { g.fillText("TAX", 30, y); g.textAlign = "right"; g.fillText(tax.toFixed(2), W - 30, y); g.textAlign = "left"; y += 40; }
  g.font = "bold 26px 'Courier New', monospace"; g.fillText("TOTAL USD", 30, y + 6); g.textAlign = "right"; g.fillText((sub + tax).toFixed(2), W - 30, y + 6);
  g.textAlign = "center"; g.font = "16px 'Courier New', monospace"; g.fillText("Synthetic example. Not a real document.", W / 2, y + 60);
  const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.9));
  const claim = { provider: s.title, reference: s.ref, party: s.party, date, currency: "USD", total: +(sub + tax).toFixed(2), tax: tax || null, confidence: 1,
    category: s.cat || "Other", lineItems: s.lines.map(([description, amount]) => ({ description, amount })) };
  return { blob, truth: claim, claim };
}

