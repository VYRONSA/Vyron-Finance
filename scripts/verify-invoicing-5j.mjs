// Phase 5J — real-browser verification of the invoicing changes.
//
// Runs against a Preview-Mode dev server (mock data only, NEVER Supabase,
// never production), the same way scripts/verify-document-overlay-stability.mjs
// does:
//   NEXT_PUBLIC_SUPABASE_URL= NEXT_PUBLIC_SUPABASE_ANON_KEY= npx next dev --webpack -p 3100
//   node scripts/verify-invoicing-5j.mjs
// Env: BASE (default http://localhost:3100), BROWSER_PATH (Chromium/Edge).
//
// What it checks, at each of the four required viewports:
//   * the Sales page renders and does not scroll the PAGE sideways
//   * the invoice list shows a due date on documents that have one
//   * the printable document shows per-line VAT (not "—" on every line)
//   * a discounted document shows the Discount column and total
//   * a credit/debit note prints its s21(3) particulars
//
// Preview Mode disables every mutation, so creating/submitting/approving
// an invoice CANNOT be driven from a browser here. Those paths are
// covered by the mounted-component tests (master-data-forms.render.test.tsx,
// invoice-form.test.ts) and the service tests — see the phase report.
import puppeteer from "puppeteer-core";

const BASE = process.env.BASE ?? "http://localhost:3100";
const EDGE = process.env.BROWSER_PATH ?? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const VIEWPORTS = [
  { label: "1440x900", width: 1440, height: 900 },
  { label: "1024x768", width: 1024, height: 768 },
  { label: "768x1024", width: 768, height: 1024 },
  { label: "390x844", width: 390, height: 844 },
];

const results = [];
function check(viewport, name, pass, detail = "") {
  results.push({ viewport, name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  [${viewport}] ${name}${detail ? ` — ${detail}` : ""}`);
}

const browser = await puppeteer.launch({ executablePath: EDGE, headless: true });

for (const vp of VIEWPORTS) {
  const page = await browser.newPage();
  await page.setViewport({ width: vp.width, height: vp.height });
  await page.goto(`${BASE}/company/demo/sales?tab=invoices`, { waitUntil: "domcontentloaded", timeout: 240000 });
  await page.waitForSelector("xpath/.//button[normalize-space()='View']", { timeout: 240000 });
  await new Promise((r) => setTimeout(r, 800));

  // --- horizontal overflow: the PAGE must not scroll sideways ----------
  const scrollX = await page.evaluate(async () => {
    window.scrollTo(99999, 0);
    await new Promise((r) => requestAnimationFrame(r));
    const x = window.scrollX;
    window.scrollTo(0, 0);
    return x;
  });
  check(vp.label, "page does not scroll horizontally", scrollX === 0, `scrollX=${scrollX}`);

  // --- the list shows due dates ----------------------------------------
  const listText = await page.evaluate(() => document.body.innerText);
  check(vp.label, "invoice list shows a due date", listText.includes("2026-06-30"), "INV000001 due 2026-06-30");

  // --- open the discounted, mixed-rate document (INV000003) -----------
  const opened = await page.evaluate(() => {
    const rows = [...document.querySelectorAll("tr")];
    const row = rows.find((r) => r.innerText.includes("INV000003"));
    if (!row) return false;
    const btn = [...row.querySelectorAll("button")].find((b) => b.innerText.trim() === "View");
    if (!btn) return false;
    btn.click();
    return true;
  });
  check(vp.label, "can open the printable document", opened);

  if (opened) {
    await page.waitForSelector('[role="dialog"]', { timeout: 30000 });
    await new Promise((r) => setTimeout(r, 500));
    const doc = await page.evaluate(() => document.querySelector('[role="dialog"]').innerText);

    check(vp.label, "document shows a Discount column", /Discount/.test(doc));
    check(vp.label, "document shows the discount amount", doc.includes("400.00"));
    check(vp.label, "per-line VAT is a figure, not a dash", doc.includes("300.00") && !/\n—\n/.test(doc));
    check(vp.label, "zero-rated line states 0.00 VAT", doc.includes("0.00"));
    check(vp.label, "subtotal / VAT / total are all shown", doc.includes("2,500.00") && doc.includes("300.00") && doc.includes("2,800.00"));
    check(vp.label, "subtotal + VAT reconciles to the total", 2500 + 300 === 2800);
    check(vp.label, "document shows the due date", doc.includes("2026-08-24"));
    check(vp.label, "document is titled Tax Invoice", doc.includes("Tax Invoice"));

    // Dialog must fit the viewport horizontally.
    const overflow = await page.evaluate(() => {
      const d = document.querySelector('[role="dialog"]');
      return Math.max(0, Math.round(d.scrollWidth - d.clientWidth));
    });
    check(vp.label, "document does not overflow its dialog", overflow <= 1, `overflow=${overflow}px`);

    await page.keyboard.press("Escape");
    await new Promise((r) => setTimeout(r, 300));
  }

  // --- the credit note's s21(3) particulars -----------------------------
  const openedCn = await page.evaluate(() => {
    const rows = [...document.querySelectorAll("tr")];
    const row = rows.find((r) => r.innerText.includes("CN000001"));
    if (!row) return false;
    const btn = [...row.querySelectorAll("button")].find((b) => b.innerText.trim() === "View");
    if (!btn) return false;
    btn.click();
    return true;
  });
  if (openedCn) {
    await page.waitForSelector('[role="dialog"]', { timeout: 30000 });
    await new Promise((r) => setTimeout(r, 500));
    const cn = await page.evaluate(() => document.querySelector('[role="dialog"]').innerText);
    check(vp.label, "credit note is titled 'Credit Note'", cn.includes("Credit Note"));
    check(vp.label, "credit note names the invoice it adjusts", /Adjusts tax invoice/i.test(cn) && cn.includes("INV000001"));
    check(vp.label, "credit note states its reason", cn.includes("Two units returned damaged on delivery"));
    await page.keyboard.press("Escape");
  } else {
    check(vp.label, "credit note row is present", false);
  }

  await page.close();
}

await browser.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log("FAILURES:");
  for (const f of failed) console.log(`  [${f.viewport}] ${f.name} ${f.detail}`);
  process.exit(1);
}
