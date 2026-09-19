/**
 * Phase 5O — builds the independent countersigning review pack.
 *
 * WHY THIS EXISTS
 *
 * The 24 answer keys were authored by the same system that will later be
 * evaluated against them. That is the one weakness in the corpus, and the
 * only fix is a second pair of eyes. This generates the page that makes
 * that review practical: each source document beside a plain-language
 * rendering of its answer key, with the specific things to check spelled
 * out.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 *  - It does not change a document or an answer key. It reads and renders.
 *  - It does not decide anything. Every checkbox is the reviewer's.
 *  - It does not phone anywhere. The page is a local file with relative
 *    links to the corpus; it loads nothing from a network and posts
 *    nothing. A review of invoice content should not leave the machine.
 *
 * THE SIGNATURE IS BOUND TO THE CORPUS HASH. The page records the
 * `corpusSha256` it was generated for and writes it into the exported
 * countersignature. Change one byte of one document or one answer key and
 * every signature becomes void — which is the point. A sign-off that
 * survived an edit would be worse than no sign-off at all.
 *
 *   node scripts/build-countersign-pack.mjs
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CORPUS = join(ROOT, "certification-corpus");
const OUT_DIR = join(CORPUS, "review");

const manifest = JSON.parse(readFileSync(join(CORPUS, "manifest.json"), "utf8"));

/** The six things a reviewer confirms per case. Deliberately few enough to
 * be done honestly 24 times, and specific enough that ticking one means
 * something. */
const CHECKS = [
  { id: "supplierIdentity", label: "Supplier name, VAT number and registration number match the page (or are absent on both)" },
  { id: "documentIdentity", label: "Document type, invoice number, invoice date and due date match the page" },
  { id: "lineItems", label: "Every line's description, quantity, UOM, unit price, discount and VAT match the page" },
  { id: "totals", label: "Printed subtotal, VAT and total match the page exactly — including where the page is wrong" },
  { id: "absenceSemantics", label: "Each field marked absent/missing/ambiguous/not-applicable is genuinely that, not merely empty" },
  { id: "expectations", label: "The expected validation, supplier-resolution, duplicate and conversion outcomes are right" },
];

const escape = (value) =>
  String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const money = (n) => {
  if (n === null || n === undefined) return "—";
  const [whole, fraction] = Number(n).toFixed(2).split(".");
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ")}.${fraction}`;
};

const show = (v) => (v === null || v === undefined || v === "" ? '<span class="absent">— not printed —</span>' : escape(v));

const STATUS_HINT = {
  present: "printed on the page",
  "correctly-absent": "NOT printed, and correctly so",
  missing: "NOT printed, but it should have been",
  ambiguous: "printed, but it identifies more than one thing",
  "not-applicable": "the concept does not arise on this document",
};

function documentEmbed(file) {
  // Relative links, not data URIs: the reviewer has the repository, the
  // page stays small, and nothing is duplicated into a second copy of the
  // corpus that could drift from the hashed one.
  const src = `../documents/${file}`;
  if (file.endsWith(".pdf")) {
    return `<embed class="doc" src="${src}" type="application/pdf"><p class="fallback">If the document does not appear, open <a href="${src}">${escape(file)}</a> directly.</p>`;
  }
  return `<a href="${src}"><img class="doc" src="${src}" alt="${escape(file)}"></a>`;
}

function linesTable(truth) {
  const rows = truth.lines
    .map((line, i) => {
      const nonMoney = line.printedNonMoneyColumns
        ? `<div class="warn">Also printed, and NOT money: ${Object.entries(line.printedNonMoneyColumns).map(([k, v]) => `${escape(k)} = ${escape(v)}`).join(", ")}</div>`
        : "";
      const printedVat = line.printedVatAmount !== undefined
        ? `<div class="warn">Printed VAT on this line: <b>${money(line.printedVatAmount)}</b> — the page says this, and the page is wrong. Check the page, not the arithmetic.</div>`
        : "";
      return `<tr>
        <td>${i + 1}</td>
        <td>${show(line.description)}${nonMoney}${printedVat}</td>
        <td>${show(line.supplierSku)}</td>
        <td class="num">${escape(line.quantity)}</td>
        <td>${show(line.uom)}</td>
        <td class="num">${money(line.unitPrice)}</td>
        <td class="num">${line.discount ? money(line.discount) : "—"}</td>
        <td class="num">${line.vatRatePercent === null ? "—" : `${escape(line.vatRatePercent)}%`}</td>
        <td class="num">${
          // Where the page prints a VAT figure that disagrees with the
          // arithmetic, show the PRINTED one here. Leaving this cell blank
          // and explaining the real value only in a note underneath invites
          // the reviewer to read it as a gap in the answer key.
          line.printedVatAmount !== undefined
            ? `${money(line.printedVatAmount)}<div class="warn">as printed</div>`
            : line.vatAmount === null
              ? "—"
              : money(line.vatAmount)
        }</td>
        <td class="num">${money(line.lineTotal)}</td>
      </tr>`;
    })
    .join("");

  return `<table class="key">
    <thead><tr><th>#</th><th>Description</th><th>Code</th><th>Qty</th><th>UOM</th><th>Unit price</th><th>Discount</th><th>VAT %</th><th>VAT</th><th>Line total</th></tr></thead>
    <tbody>${rows}</tbody></table>`;
}

function caseSection(entry, truth) {
  const mismatch = truth.documentIsArithmeticallyWrong
    ? `<div class="alert"><b>This document is deliberately WRONG.</b> It prints VAT ${money(truth.printedTotals.vatAmount)} and a total of
       ${money(truth.printedTotals.total)}, where the arithmetic gives ${money(truth.independentArithmetic.vat)} and
       ${money(truth.independentArithmetic.total)}. The answer key records what is <b>printed</b>. Confirm the page really does
       print the wrong figures, and that the key has not been "corrected".</div>`
    : "";

  const statuses = Object.entries(truth.fieldStatus)
    .map(([field, status]) => `<tr><td>${escape(field)}</td><td><span class="pill ${escape(status)}">${escape(status)}</span></td><td>${escape(STATUS_HINT[status] ?? "")}</td></tr>`)
    .join("");

  const checks = CHECKS.map(
    (c) => `<label class="check"><input type="checkbox" data-case="${escape(truth.caseId)}" data-check="${escape(c.id)}"> ${escape(c.label)}</label>`,
  ).join("");

  return `<section class="case" id="case-${escape(truth.caseId)}">
  <h2><span class="idx"></span>${escape(truth.caseId)} <span class="file">${escape(truth.documentId)}</span></h2>
  <p class="notes">${escape(truth.notes)}</p>
  ${truth.duplicateScenario ? `<p class="notes"><b>Duplicate scenario:</b> ${escape(truth.duplicateScenario)}</p>` : ""}
  ${mismatch}

  <div class="split">
    <div class="pane">
      <h3>The document</h3>
      ${documentEmbed(truth.documentId)}
      <p class="hash">SHA-256 ${escape(entry.documentSha256)}</p>
    </div>

    <div class="pane">
      <h3>The answer key — does the page say exactly this?</h3>
      <table class="key kv">
        <tr><th>Document type</th><td>${escape(truth.documentType)}</td></tr>
        <tr><th>Supplier</th><td>${show(truth.supplier.name)}</td></tr>
        <tr><th>Supplier VAT no.</th><td>${show(truth.supplier.vatNumber)}</td></tr>
        <tr><th>Supplier reg. no.</th><td>${show(truth.supplier.registrationNumber)}</td></tr>
        <tr><th>Invoice number</th><td>${show(truth.invoiceNumber)}</td></tr>
        <tr><th>Invoice date</th><td>${escape(truth.invoiceDate)}</td></tr>
        <tr><th>Due date</th><td>${show(truth.dueDate)}</td></tr>
        <tr><th>Order reference</th><td>${show(truth.orderReference)}</td></tr>
        <tr><th>Currency</th><td>${escape(truth.currency)}</td></tr>
      </table>

      ${linesTable(truth)}

      <table class="key kv">
        <tr><th>Printed subtotal</th><td class="num">${truth.printedTotals.subtotal === undefined ? "— none printed —" : money(truth.printedTotals.subtotal)}</td></tr>
        <tr><th>Printed discount</th><td class="num">${truth.printedTotals.discountTotal === undefined ? "— none printed —" : money(truth.printedTotals.discountTotal)}</td></tr>
        <tr><th>Printed VAT</th><td class="num">${truth.printedTotals.vatAmount === undefined ? "— none printed —" : money(truth.printedTotals.vatAmount)}</td></tr>
        <tr><th>Printed TOTAL</th><td class="num"><b>${money(truth.printedTotals.total)}</b></td></tr>
      </table>

      <h4>Field status — absence is not all the same thing</h4>
      <table class="key"><tbody>${statuses}</tbody></table>

      <h4>Expected system behaviour</h4>
      <table class="key kv">
        <tr><th>Validation findings</th><td>${truth.expected.validationFindings.length ? escape(truth.expected.validationFindings.join(", ")) : "none"}</td></tr>
        <tr><th>Supplier resolution</th><td>${escape(truth.expected.supplierResolution)}</td></tr>
        <tr><th>Duplicate</th><td>${escape(truth.expected.duplicate)}</td></tr>
        <tr><th>Conversion</th><td>${escape(truth.expected.conversion)}</td></tr>
      </table>
      <p class="hash">Answer key SHA-256 ${escape(entry.groundTruthSha256)}</p>
    </div>
  </div>

  <div class="signoff">
    <h4>Reviewer confirmation</h4>
    ${checks}
    <label class="disc">Discrepancy found? Describe it — field, what the key says, what the page says, and why.
      <textarea data-case="${escape(truth.caseId)}" rows="3" placeholder="Leave blank if the answer key is correct."></textarea>
    </label>
    <div class="status" data-status="${escape(truth.caseId)}">Not yet reviewed</div>
  </div>
</section>`;
}

function build() {
  const sections = manifest.cases
    .map((entry) => {
      const truth = JSON.parse(readFileSync(join(CORPUS, "ground-truth", entry.groundTruthFile), "utf8"));
      return caseSection(entry, truth);
    })
    .join("\n");

  const nav = manifest.cases
    .map((c, i) => `<a href="#case-${c.caseId}" data-nav="${c.caseId}">${i + 1}. ${c.caseId}</a>`)
    .join("");

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Certification Corpus Countersigning</title>
<style>
  :root { --line:#d8d8d5; --ink:#16181d; --muted:#5d6470; --accent:#1f5f3f; --warn:#8a5a00; --alert:#9b2222; --bg:#fbfbf9; --panel:#fff; }
  * { box-sizing:border-box; }
  body { margin:0; font:15px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif; color:var(--ink); background:var(--bg); }
  header.top { position:sticky; top:0; z-index:10; background:var(--panel); border-bottom:1px solid var(--line); padding:14px 20px; }
  header.top h1 { margin:0 0 4px; font-size:19px; }
  .meta { color:var(--muted); font-size:13px; font-family:ui-monospace,Menlo,Consolas,monospace; word-break:break-all; }
  .progress { margin-top:8px; font-size:14px; }
  .bar { height:7px; background:#e8e8e4; border-radius:4px; overflow:hidden; margin-top:5px; max-width:460px; }
  .bar i { display:block; height:100%; width:0; background:var(--accent); transition:width .2s; }
  nav { display:flex; flex-wrap:wrap; gap:5px; padding:10px 20px; background:#f2f2ee; border-bottom:1px solid var(--line); }
  nav a { font-size:12px; text-decoration:none; color:var(--muted); border:1px solid var(--line); border-radius:4px; padding:2px 7px; background:#fff; }
  nav a.done { background:var(--accent); color:#fff; border-color:var(--accent); }
  nav a.flag { background:var(--alert); color:#fff; border-color:var(--alert); }
  main { padding:20px; max-width:1500px; margin:0 auto; }
  .intro { background:var(--panel); border:1px solid var(--line); border-left:4px solid var(--accent); padding:14px 18px; margin-bottom:22px; }
  .intro p { margin:8px 0; }
  section.case { background:var(--panel); border:1px solid var(--line); border-radius:6px; padding:18px; margin-bottom:26px; }
  section.case h2 { margin:0 0 4px; font-size:18px; }
  section.case h2 .file { font-weight:400; color:var(--muted); font-size:13px; font-family:ui-monospace,Menlo,Consolas,monospace; }
  .notes { color:var(--muted); margin:4px 0 12px; font-size:14px; }
  .split { display:grid; grid-template-columns:1fr 1fr; gap:18px; }
  @media (max-width:1100px){ .split { grid-template-columns:1fr; } }
  .pane h3 { margin:0 0 8px; font-size:14px; text-transform:uppercase; letter-spacing:.5px; color:var(--muted); }
  .pane h4 { margin:16px 0 6px; font-size:13px; }
  embed.doc { width:100%; height:760px; border:1px solid var(--line); background:#fff; }
  img.doc { width:100%; border:1px solid var(--line); background:#fff; }
  .fallback { font-size:12px; color:var(--muted); }
  table.key { width:100%; border-collapse:collapse; font-size:13px; margin-bottom:10px; }
  table.key th, table.key td { border:1px solid var(--line); padding:5px 7px; text-align:left; vertical-align:top; }
  table.key thead th { background:#f2f2ee; }
  table.kv th { width:170px; background:#f8f8f5; }
  .num { text-align:right; font-variant-numeric:tabular-nums; }
  .absent { color:var(--muted); font-style:italic; }
  .warn { color:var(--warn); font-size:12px; margin-top:3px; }
  .alert { background:#fdf3f3; border:1px solid #e6c4c4; border-left:4px solid var(--alert); padding:10px 14px; margin:10px 0; font-size:14px; }
  .pill { display:inline-block; padding:1px 7px; border-radius:10px; font-size:11px; background:#eee; }
  .pill.present{background:#e3f0e8;} .pill.missing{background:#fbe3e3;} .pill.ambiguous{background:#fdf0da;}
  .pill.correctly-absent{background:#e6ecf5;} .pill.not-applicable{background:#ededea;}
  .hash { font-family:ui-monospace,Menlo,Consolas,monospace; font-size:11px; color:var(--muted); word-break:break-all; }
  .signoff { margin-top:16px; padding-top:14px; border-top:2px solid var(--line); }
  .signoff h4 { margin:0 0 8px; font-size:14px; }
  label.check { display:block; margin:5px 0; font-size:14px; cursor:pointer; }
  label.disc { display:block; margin-top:10px; font-size:13px; color:var(--muted); }
  textarea { width:100%; font:13px/1.4 inherit; padding:7px; border:1px solid var(--line); border-radius:4px; margin-top:4px; }
  .status { margin-top:8px; font-size:13px; font-weight:600; color:var(--muted); }
  .status.done { color:var(--accent); }
  .status.flag { color:var(--alert); }
  footer.export { position:sticky; bottom:0; background:var(--panel); border-top:1px solid var(--line); padding:12px 20px; display:flex; gap:10px; align-items:center; flex-wrap:wrap; }
  input[type=text] { padding:6px 9px; border:1px solid var(--line); border-radius:4px; font:14px inherit; }
  button { padding:7px 14px; border:1px solid var(--accent); background:var(--accent); color:#fff; border-radius:4px; font:14px inherit; cursor:pointer; }
  button.ghost { background:#fff; color:var(--accent); }
  #out { width:100%; height:180px; font-family:ui-monospace,Menlo,Consolas,monospace; font-size:11px; display:none; margin-top:10px; }
</style></head>
<body>
<header class="top">
  <h1>Certification corpus — independent countersigning</h1>
  <div class="meta">corpus ${escape(manifest.corpusSha256)} · ${manifest.caseCount} cases</div>
  <div class="progress"><span id="count">0 of ${manifest.caseCount} reviewed</span>
    <div class="bar"><i id="barfill"></i></div></div>
</header>
<nav>${nav}</nav>
<main>
  <div class="intro">
    <p><b>What you are doing.</b> The 24 answer keys were written by the same system that will later be measured against
       them. Until someone else has read each document and agreed with its key, any accuracy figure produced from this
       corpus is partly marking its own homework. You are that someone else.</p>
    <p><b>How to do it.</b> For each case, read the document on the left and confirm the key on the right says exactly what
       the page says. Tick each line only once you have actually checked it. If anything disagrees, describe it in the box
       rather than ticking — a discrepancy is a useful result, not a failure.</p>
    <p><b>Two things that are easy to get wrong.</b> First, <code>arithmetic-mismatch</code> is <i>supposed</i> to be wrong:
       the key must record what is printed, not what the arithmetic says. Second, an empty field is not automatically an
       error — check whether it is <i>correctly absent</i> (nothing should be there), <i>missing</i> (something should),
       <i>ambiguous</i>, or <i>not applicable</i>.</p>
    <p><b>Your progress is saved in this browser only.</b> Nothing is sent anywhere. When all 24 are done, enter your name
       and export the countersignature file.</p>
  </div>
  ${sections}
</main>
<footer class="export">
  <label>Reviewer name <input type="text" id="who" placeholder="Your full name" size="26"></label>
  <button id="btn">Export countersignature</button>
  <button class="ghost" id="clear">Clear my progress</button>
  <span id="msg" class="meta"></span>
  <textarea id="out" readonly></textarea>
</footer>
<script>
const CORPUS = ${JSON.stringify(manifest.corpusSha256)};
const CASES = ${JSON.stringify(manifest.cases.map((c) => c.caseId))};
const CHECKS = ${JSON.stringify(CHECKS.map((c) => c.id))};
// Keyed by corpus hash: if the corpus changes, previous ticks do not carry
// over, because they were about different bytes.
const KEY = "countersign:" + CORPUS;

function load() { try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { return {}; } }
function save(state) { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {} }

const state = load();

function caseState(id) { return state[id] || (state[id] = { checks: {}, note: "" }); }
function isAgreed(id) { const s = caseState(id); return CHECKS.every(c => s.checks[c]) && !(s.note || "").trim(); }
function isFlagged(id) { return (caseState(id).note || "").trim().length > 0; }
function isDone(id) { return isAgreed(id) || isFlagged(id); }

function render() {
  let done = 0;
  for (const id of CASES) {
    const el = document.querySelector('[data-status="' + id + '"]');
    const nav = document.querySelector('[data-nav="' + id + '"]');
    nav.classList.remove("done", "flag");
    if (isFlagged(id)) { el.textContent = "Discrepancy recorded — will be reported, not silently fixed"; el.className = "status flag"; nav.classList.add("flag"); done++; }
    else if (isAgreed(id)) { el.textContent = "Agreed — the key matches the page"; el.className = "status done"; nav.classList.add("done"); done++; }
    else { const n = CHECKS.filter(c => caseState(id).checks[c]).length; el.textContent = n === 0 ? "Not yet reviewed" : n + " of " + CHECKS.length + " confirmed"; el.className = "status"; }
  }
  document.getElementById("count").textContent = done + " of " + CASES.length + " reviewed";
  document.getElementById("barfill").style.width = (done / CASES.length * 100) + "%";
}

for (const box of document.querySelectorAll('input[type=checkbox]')) {
  const id = box.dataset.case, check = box.dataset.check;
  box.checked = Boolean(caseState(id).checks[check]);
  box.addEventListener("change", () => { caseState(id).checks[check] = box.checked; save(state); render(); });
}
for (const area of document.querySelectorAll('textarea[data-case]')) {
  const id = area.dataset.case;
  area.value = caseState(id).note || "";
  area.addEventListener("input", () => { caseState(id).note = area.value; save(state); render(); });
}
document.getElementById("who").value = state.__who || "";
document.getElementById("who").addEventListener("input", e => { state.__who = e.target.value; save(state); });

document.getElementById("clear").addEventListener("click", () => {
  if (!confirm("Clear all ticks and notes for this corpus?")) return;
  try { localStorage.removeItem(KEY); } catch {}
  location.reload();
});

document.getElementById("btn").addEventListener("click", () => {
  const who = (document.getElementById("who").value || "").trim();
  const msg = document.getElementById("msg");
  if (!who) { msg.textContent = "Enter your name first — an unattributed sign-off is not a sign-off."; return; }
  const outstanding = CASES.filter(id => !isDone(id));
  if (outstanding.length) { msg.textContent = outstanding.length + " case(s) still unreviewed: " + outstanding.slice(0, 4).join(", ") + (outstanding.length > 4 ? "…" : ""); return; }

  const today = new Date().toISOString().slice(0, 10);
  const out = { corpusSha256: CORPUS, reviewedBy: who, reviewedOn: today, cases: {} };
  for (const id of CASES) {
    const s = caseState(id);
    out.cases[id] = {
      status: isFlagged(id) ? "discrepancy" : "agreed",
      reviewedBy: who,
      reviewedOn: today,
      checks: Object.fromEntries(CHECKS.map(c => [c, Boolean(s.checks[c])])),
      discrepancies: isFlagged(id) ? [{ field: "(see note)", originalValue: "", correctedValue: "", reason: s.note.trim() }] : [],
      notes: (s.note || "").trim(),
    };
  }
  const text = JSON.stringify(out, null, 2) + "\\n";
  const area = document.getElementById("out");
  area.style.display = "block";
  area.value = text;
  area.select();
  try { navigator.clipboard.writeText(text); } catch {}
  msg.textContent = "Copied. Save this over certification-corpus/countersignatures.json";
});

render();
</script>
</body></html>`;

  mkdirSync(OUT_DIR, { recursive: true });
  const outPath = join(OUT_DIR, "countersign-pack.html");
  writeFileSync(outPath, html, "utf8");
  console.log(`Review pack written: certification-corpus/review/countersign-pack.html`);
  console.log(`  ${manifest.caseCount} cases, ${CHECKS.length} confirmations each (${manifest.caseCount * CHECKS.length} total)`);
  console.log(`  bound to corpus ${manifest.corpusSha256}`);
}

build();
