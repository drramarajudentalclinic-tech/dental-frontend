/* ═══════════════════════════════════════════════════════════════════════
   IMPLANT PLANNING REPORT — downloadable
   • "Print / Save as PDF": a clean A4 report in a new tab (Save as PDF from
     the print window — works on computers, Android and iPhone).
   • "Download report (image)": the same report as one PNG picture.
   • "Download plan file": every implant and nerve in scan millimetres
     (for records, a second opinion or a surgical-guide lab).
   ═══════════════════════════════════════════════════════════════════════ */
import { implantNerveGap, implantDensity, implantTilt, implantGap, implantApex } from "./geometry";

const CLINIC = "Sri Satya Sai Oral Health Center & Dental Clinic";
const DOCTOR = "Dr. D. Rama Raju, BDS, MDS";
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const r1 = (n) => (Math.round(n * 10) / 10).toFixed(1);

export function implantRows(plan, vol) {
  const list = plan.implants || [];
  return list.map((im, i) => {
    const g = implantNerveGap(im, plan.nerves);
    const dens = implantDensity(im, vol);
    let nearest = null;
    list.forEach((o) => { if (o.id !== im.id) { const d = implantGap(im, o); if (nearest === null || d < nearest.d) nearest = { d, tooth: o.tooth }; } });
    return {
      n: i + 1, tooth: im.tooth || "—", system: im.system || "—", size: `Ø${im.diameter} × ${im.length} mm`,
      tilt: `${implantTilt(im)}°`, nerve: g ? (g.gap < 0 ? `overlaps ${r1(-g.gap)} mm` : `${r1(g.gap)} mm`) : "no nerve traced", nerveWarn: g ? g.gap < (plan.safety ?? 2) : false,
      bone: dens ? `${dens.hu} HU (${dens.cls})` : "—", neighbour: nearest ? `${r1(nearest.d)} mm (#${nearest.tooth || "?"})` : "—",
      neighbourWarn: nearest ? nearest.d < 3 : false, note: im.note || "",
      top: im.top.map(r1).join(", "), apex: implantApex(im).map(r1).join(", "),
    };
  });
}

/* sections the doctor can switch on / off in the Report tab */
export const REPORT_SECTIONS = [
  ["notes", "Doctor's notes"], ["warnings", "Safety warnings"], ["pano", "Panoramic view"], ["implants", "Implant table"],
  ["perImplant", "Pictures of each implant"], ["three", "3-D picture"], ["guide", "Surgical guide"], ["measures", "Measurements"],
  ["ceph", "Ceph (2-D)"], ["ceph3d", "3D Ceph"], ["airway", "Airway"], ["tmj", "TMJ"], ["fusion", "Before / after"], ["signature", "Signature"],
];
const nl = (t) => esc(t).replace(/\n/g, "<br>");
export function buildReportHTML({ meta, plan, vol, images, when = new Date(), show = {}, notes = {}, extras = {}, title = "Implant planning report" }) {
  const on = (k) => show[k] !== false;
  const rows = implantRows(plan, vol);
  const warns = [];
  rows.forEach((r) => {
    if (r.nerveWarn) warns.push(r.nerve.startsWith("overlaps") ? `Implant #${r.tooth} ${r.nerve} into the nerve canal — shorten, move or tilt it.` : `Implant #${r.tooth}: only ${r.nerve} from the nerve (safety margin ${plan.safety ?? 2} mm).`);
    if (r.neighbourWarn) warns.push(`Implant #${r.tooth}: ${r.neighbour} from the next implant (less than 3 mm).`);
  });
  const d = when.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  const per = (images.implants || []).map((im, i) => `
    <section class="imp">
      <h3>Implant ${i + 1} — tooth ${esc(rows[i]?.tooth)} · ${esc(rows[i]?.system)} ${esc(rows[i]?.size)}</h3>
      <div class="pair">
        <figure><img src="${im.cross}" alt=""><figcaption>Cross-section</figcaption></figure>
        <figure><img src="${im.axial}" alt=""><figcaption>Axial at mid-implant</figcaption></figure>
      </div>
      <p class="kv">Distance to nerve: <b class="${rows[i]?.nerveWarn ? "bad" : ""}">${esc(rows[i]?.nerve)}</b> ·
        Tilt from vertical: <b>${esc(rows[i]?.tilt)}</b> · Bone around implant: <b>${esc(rows[i]?.bone)}</b>
        ${rows[i]?.note ? ` · Note: ${esc(rows[i].note)}` : ""}</p>
    </section>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} — ${esc(meta?.patient_name || "patient")}</title>
<style>
  @page { size: A4; margin: 12mm; }
  *{box-sizing:border-box} body{font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#0f172a;margin:0;padding:18px;max-width:900px;margin:auto;font-size:13px}
  header{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:3px solid #0f766e;padding-bottom:8px;margin-bottom:12px;gap:12px}
  h1{font-size:20px;margin:0;color:#0f766e} h2{font-size:15px;margin:18px 0 8px} h3{font-size:13.5px;margin:0 0 6px}
  .sub{color:#475569;font-size:12px}
  table{width:100%;border-collapse:collapse;font-size:12px} th,td{border:1px solid #cbd5e1;padding:5px 6px;text-align:left;vertical-align:top}
  th{background:#f1f5f9} .bad{color:#b91c1c;font-weight:800}
  img{width:100%;display:block;border-radius:6px;background:#000} figure{margin:0} figcaption{font-size:11px;color:#64748b;margin-top:3px}
  .pair{display:grid;grid-template-columns:1fr 1fr;gap:8px} .imp{break-inside:avoid;border:1px solid #e2e8f0;border-radius:10px;padding:10px;margin:10px 0}
  .warn{background:#fef2f2;border:1px solid #fecaca;color:#991b1b;border-radius:8px;padding:8px 10px;margin:8px 0}
  .kv{margin:6px 0 0} .note{font-size:11px;color:#64748b;margin-top:16px;border-top:1px solid #e2e8f0;padding-top:8px}
  .notes h3{font-size:12.5px;margin:10px 0 3px;color:#0f766e} .notes p{margin:0 0 4px;white-space:normal}
  .sign{display:flex;justify-content:flex-end;margin-top:28px} .sign div{text-align:center;min-width:220px;border-top:1px solid #334155;padding-top:6px;font-size:12px}
  .bar{position:sticky;top:0;background:#fff;padding:8px 0;display:flex;gap:8px;justify-content:flex-end}
  .bar button{border:none;border-radius:8px;padding:9px 16px;font-weight:700;cursor:pointer;background:#0f766e;color:#fff}
  @media print{.bar{display:none} body{padding:0}}
</style></head><body>
<div class="bar"><button onclick="window.print()">🖨 Print / Save as PDF</button></div>
<header><div><h1>${esc(title)}</h1><div class="sub">${esc(CLINIC)}</div></div>
<div class="sub" style="text-align:right">${esc(DOCTOR)}<br>Planned ${esc(d)}</div></header>
<p><b>Patient:</b> ${esc(meta?.patient_name || "—")} &nbsp; <b>Scan date:</b> ${esc(meta?.study_date || "—")} &nbsp;
<b>Jaw:</b> ${esc(plan.jaw === "upper" ? "Upper" : "Lower")} &nbsp; <b>Voxel:</b> ${vol ? r1(vol.sx) : "?"} mm (viewer)</p>
${on("notes") && ["findings", "diagnosis", "plan", "remarks"].some((k) => (notes[k] || "").trim()) ? `<section class="notes"><h2>Clinical notes</h2>
${[["findings", "Findings"], ["diagnosis", "Diagnosis"], ["plan", "Treatment plan"], ["remarks", "Remarks"]].filter(([k]) => (notes[k] || "").trim()).map(([k, l]) => `<h3>${l}</h3><p>${nl(notes[k])}</p>`).join("")}</section>` : ""}
${on("warnings") && warns.length ? `<div class="warn"><b>⚠ Check before surgery</b><br>${warns.map(esc).join("<br>")}</div>` : ""}
${on("pano") && images.pano ? `<h2>Panoramic view</h2><img src="${images.pano}" alt="">` : ""}
${on("implants") ? `<h2>Implants (${rows.length})</h2>
${rows.length ? `<table><thead><tr><th>#</th><th>Tooth</th><th>System</th><th>Size</th><th>Tilt</th><th>To nerve</th><th>To next implant</th><th>Bone (approx.)</th></tr></thead><tbody>
${rows.map((r) => `<tr><td>${r.n}</td><td>${esc(r.tooth)}</td><td>${esc(r.system)}</td><td>${esc(r.size)}</td><td>${esc(r.tilt)}</td>
<td class="${r.nerveWarn ? "bad" : ""}">${esc(r.nerve)}</td><td class="${r.neighbourWarn ? "bad" : ""}">${esc(r.neighbour)}</td><td>${esc(r.bone)}</td></tr>`).join("")}
</tbody></table>` : "<p>No implants planned.</p>"}
${(plan.nerves || []).length ? `<p><b>Nerve canal traced:</b> ${(plan.nerves || []).map((n) => `${n.side === "L" ? "left" : n.side === "R" ? "right" : ""} (Ø ${n.diameter || 2} mm)`).join(", ")} · Safety margin ${plan.safety ?? 2} mm</p>` : ""}` : ""}
${on("perImplant") ? per : ""}
${on("guide") && extras.guide ? extras.guide : ""}
${on("three") && images.three ? `<h2>3-D view</h2><img src="${images.three}" alt="" style="max-width:520px">` : ""}
${["ceph", "ceph3d", "airway", "tmj", "fusion"].filter((k) => on(k) && extras[k]).map((k) => extras[k]).join("\n")}
${on("measures") && (plan.measures || []).length ? `<h2>Measurements</h2><ul>${plan.measures.map((m) => `<li>${m.type === "hu" ? `Density ${esc(m.value)} HU` : m.type === "angle" ? `Angle ${esc(m.value)}°` : `Distance ${esc(m.value)} mm`}${m.label ? ` — ${esc(m.label)}` : ""}</li>`).join("")}</ul>` : ""}
${on("signature") ? `<div class="sign"><div>${esc(DOCTOR)}<br><span style="color:#64748b">Signature</span></div></div>` : ""}
<p class="note">Planning aid made from the CBCT scan. Distances are measured in the scan; CBCT grey values (HU) are approximate.
Confirm the plan clinically and with the implant manufacturer's guidelines before surgery.</p>
</body></html>`;
}

export function openReport(html, preOpened) {
  const w = preOpened || window.open("", "_blank");
  if (!w) { downloadBlob(new Blob([html], { type: "text/html" }), "implant-plan-report.html"); return false; }
  w.document.open(); w.document.write(html); w.document.close();
  return true;
}

export function downloadBlob(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/* the report as one tall PNG */
export async function reportPNG({ meta, plan, vol, images }) {
  const rows = implantRows(plan, vol);
  const W = 1400, pad = 40;
  const load = (src) => new Promise((res) => { if (!src) return res(null); const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = src; });
  const pano = await load(images.pano);
  const per = await Promise.all((images.implants || []).map(async (x) => ({ cross: await load(x.cross), axial: await load(x.axial) })));
  const three = await load(images.three);
  let H = 170 + (pano ? (pano.height * (W - 2 * pad)) / pano.width + 50 : 0) + 60 + rows.length * 34 + 40;
  per.forEach(() => { H += 520; });
  if (three) H += 560;
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const g = c.getContext("2d");
  g.fillStyle = "#fff"; g.fillRect(0, 0, W, H);
  let y = pad;
  g.fillStyle = "#0f766e"; g.font = "800 34px system-ui, sans-serif"; g.fillText("Implant planning report", pad, y + 30);
  g.fillStyle = "#475569"; g.font = "500 18px system-ui, sans-serif";
  g.fillText(`${CLINIC} · ${DOCTOR}`, pad, y + 62);
  g.fillText(`Patient: ${meta?.patient_name || "—"} · Scan: ${meta?.study_date || "—"} · Planned: ${new Date().toLocaleDateString("en-GB")}`, pad, y + 90);
  g.fillStyle = "#0f766e"; g.fillRect(pad, y + 106, W - 2 * pad, 4);
  y += 130;
  if (pano) { const h = (pano.height * (W - 2 * pad)) / pano.width; g.drawImage(pano, pad, y, W - 2 * pad, h); y += h + 30; }
  g.fillStyle = "#0f172a"; g.font = "800 22px system-ui, sans-serif"; g.fillText(`Implants (${rows.length})`, pad, y); y += 16;
  const cols = [["#", 40], ["Tooth", 80], ["System", 250], ["Size", 170], ["Tilt", 70], ["To nerve", 170], ["To next", 190], ["Bone", 180]];
  g.font = "700 16px system-ui, sans-serif"; let x = pad; g.fillStyle = "#f1f5f9"; g.fillRect(pad, y, W - 2 * pad, 30);
  g.fillStyle = "#0f172a"; cols.forEach(([t, w]) => { g.fillText(t, x + 6, y + 21); x += w; }); y += 32;
  g.font = "500 16px system-ui, sans-serif";
  rows.forEach((r) => {
    x = pad;
    [r.n, r.tooth, r.system, r.size, r.tilt, r.nerve, r.neighbour, r.bone].forEach((v, i) => {
      g.fillStyle = (i === 5 && r.nerveWarn) || (i === 6 && r.neighbourWarn) ? "#b91c1c" : "#0f172a";
      g.fillText(String(v).slice(0, 28), x + 6, y + 21); x += cols[i][1];
    });
    g.strokeStyle = "#e2e8f0"; g.beginPath(); g.moveTo(pad, y + 32); g.lineTo(W - pad, y + 32); g.stroke(); y += 34;
  });
  y += 20;
  per.forEach((p, i) => {
    g.fillStyle = "#0f172a"; g.font = "800 18px system-ui, sans-serif";
    g.fillText(`Implant ${i + 1} — tooth ${rows[i]?.tooth} · ${rows[i]?.size} · nerve ${rows[i]?.nerve}`, pad, y + 20);
    const w2 = (W - 2 * pad - 20) / 2;
    if (p.cross) g.drawImage(p.cross, pad, y + 34, w2, 450);
    if (p.axial) g.drawImage(p.axial, pad + w2 + 20, y + 34, w2, 450);
    y += 520;
  });
  if (three) { g.drawImage(three, pad, y, 540, 540 * (three.height / three.width)); y += 560; }
  g.fillStyle = "#64748b"; g.font = "500 14px system-ui, sans-serif";
  g.fillText("Planning aid. Confirm clinically; CBCT grey values (HU) are approximate.", pad, H - 16);
  return new Promise((res) => c.toBlob(res, "image/png"));
}

export function planFile({ meta, plan, vol, volumeId }) {
  const rows = implantRows(plan, vol);
  return {
    kind: "implant-plan", version: 2, clinic: CLINIC, made: new Date().toISOString(), scan: { id: volumeId, patient: meta?.patient_name, date: meta?.study_date },
    units: "mm (scan coordinates: x = column, y = row, z = slice)",
    jaw: plan.jaw, safety_margin_mm: plan.safety ?? 2,
    implants: (plan.implants || []).map((im, i) => ({ tooth: im.tooth, system: im.system, diameter: im.diameter, length: im.length,
      platform: im.top, apex: implantApex(im), axis: im.axis, tilt_deg: rows[i]?.tilt, nerve_distance: rows[i]?.nerve, bone: rows[i]?.bone, note: im.note || "" })),
    nerves: (plan.nerves || []).map((n) => ({ side: n.side, diameter: n.diameter, points: n.points })),
    arch: plan.archPoints, measurements: plan.measures || [],
  };
}