// Real-browser verification of the Reporting Centre: navigation, every
// area, a report per family, URL-driven filters, drill-down to a source
// document, the print view, CSV/Excel exports, and no page errors.
//
// Run against a Preview-Mode dev server (mock data only, never Supabase):
//   NEXT_PUBLIC_SUPABASE_URL= NEXT_PUBLIC_SUPABASE_ANON_KEY= npx next dev --webpack -p 3100
//   node scripts/verify-reporting-centre.mjs
// Env: BASE, BROWSER_PATH, SHOTS (screenshot directory, default: OS temp).
import puppeteer from "puppeteer-core";
const BASE = process.env.BASE ?? "http://localhost:3100";
const SHOTS = process.env.SHOTS ?? (await import("node:os")).tmpdir();
const EDGE = process.env.BROWSER_PATH ?? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const browser = await puppeteer.launch({ executablePath: EDGE, headless: true, defaultViewport: { width: 1440, height: 900 } });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error" && !/501|Failed to load resource/.test(m.text())) errors.push(`console: ${m.text().slice(0, 200)}`); });
const results = [];
const ok = (name, pass, detail = "") => { results.push({ name, pass }); console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`); };

async function open(path, waitText, timeout = 240000) {
  await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded", timeout });
  await page.waitForFunction((t) => document.body.innerText.includes(t), { timeout }, waitText);
  await new Promise((r) => setTimeout(r, 600));
}

await open("/company/demo/reporting", "Reporting Centre");
const nav = await page.evaluate(() => [...document.querySelectorAll("nav a")].map((a) => a.textContent.trim()).filter((t) => ["Reporting Centre", "Management", "Document Centre", "Budgets & Forecasts", "VAT & Tax"].includes(t)));
ok("sidebar has the Reporting group", nav.length === 5, nav.join(", "));
const cards = await page.evaluate(() => [...document.querySelectorAll("a")].filter((a) => /\d+ reports/.test(a.textContent)).length);
ok("home lists the 12 report areas", cards >= 12, `${cards} area cards`);
await page.screenshot({ path: `${SHOTS}/01-home.png`, fullPage: true });

const REPORTS = [
  ["management", "management-pack", "", "Management Pack"],
  ["financial", "balance-sheet", "", "Statement of Financial Position"],
  ["financial", "profit-and-loss", "", "Profit & Loss"],
  ["general-ledger", "trial-balance", "", "Trial Balance"],
  ["customers", "customer-aging", "", "Customer Aging"],
  ["customers", "customer-statement", "&customerId=1", "Customer Statement"],
  ["suppliers", "supplier-ledger", "", "Supplier Ledger"],
  ["sales", "sales-by-customer", "", "Sales by Customer"],
  ["purchasing", "purchase-summary", "", "Purchase Summary"],
  ["banking", "transaction-lifecycle", "", "Transaction Lifecycle"],
  ["vat", "vat-summary", "", "VAT Summary"],
  ["inventory", "stock-valuation", "", "Stock Valuation"],
  ["audit", "audit-trail", "", "Audit Trail"],
  ["documents", "document-register", "", "Document Register"],
];
for (const [cat, id, extra, title] of REPORTS) {
  await open(`/company/demo/reporting/${cat}?report=${id}${extra}`, title);
  const info = await page.evaluate(() => {
    const h2 = document.querySelector("section h2")?.textContent ?? "";
    const rows = document.querySelectorAll("section table tbody tr").length;
    const checks = [...document.querySelectorAll("p")].map((p) => p.textContent).find((t) => /^Reconciled —|reconciliation check/.test(t)) ?? "no checks";
    const prompt = document.body.innerText.includes("Choose a") ;
    return { h2, rows, checks, prompt };
  });
  ok(`${id} renders`, info.h2.includes(title) && (info.rows > 0 || info.prompt), `${info.rows} rows · ${info.checks}`);
}
await open("/company/demo/reporting/customers?report=customer-aging", "Customer Aging");
await page.screenshot({ path: `${SHOTS}/02-customer-aging.png`, fullPage: true });

// Filter change round-trips through the URL.
await open("/company/demo/reporting/financial?report=profit-and-loss", "Profit & Loss");
await page.click("xpath/.//button[normalize-space()='Last month']");
await page.waitForFunction(() => location.search.includes("dateFrom="), { timeout: 120000 });
ok("quick period re-runs the report via the URL", true, await page.evaluate(() => location.search));

// Drill-down: statement row -> document.
await open("/company/demo/reporting/customers?report=customer-statement&customerId=1", "Customer Statement");
const drillHref = await page.evaluate(() => [...document.querySelectorAll("section table a")].map((a) => a.getAttribute("href")).find((h) => h.includes("/documents/")));
ok("statement rows drill to the source document", Boolean(drillHref), drillHref ?? "none");
if (drillHref) {
  await page.goto(`${BASE}${drillHref}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[role="dialog"]', { timeout: 240000 });
  await new Promise((r) => setTimeout(r, 800));
  const doc = await page.evaluate(() => ({ title: document.querySelector('[role="dialog"]').getAttribute("aria-label"), underBody: document.querySelector('[role="dialog"]').parentElement.parentElement === document.body, trace: /trace through the books/i.test(document.body.innerText), download: !!document.querySelector('a[href*="/pdf"]') }));
  ok("document reprint opens in the portaled overlay with trace + PDF", doc.underBody && doc.download && doc.trace, JSON.stringify(doc));
  await page.screenshot({ path: `${SHOTS}/03-document.png`, fullPage: false });
}

// Print view.
await open("/company/demo/reporting/print/trial-balance", "Trial Balance");
await page.waitForSelector('[role="dialog"]');
const pv = await page.evaluate(() => ({ print: !![...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Print"), pdf: document.querySelector('a[href*="format=pdf"]')?.getAttribute("href"), printable: !!document.getElementById("document-preview-printable"), links: document.querySelectorAll("#document-preview-printable a").length }));
ok("print view has Print, Download PDF and a link-free printable document", pv.print && !!pv.pdf && pv.printable && pv.links === 0, JSON.stringify(pv));
await page.emulateMediaType("print");
await page.screenshot({ path: `${SHOTS}/04-print-trial-balance.png`, fullPage: true });
await page.emulateMediaType("screen");

// CSV / Excel exports work in Preview Mode.
const csv = await page.evaluate(async () => { const r = await fetch("/api/companies/demo/reporting/trial-balance/export?format=csv"); return { status: r.status, type: r.headers.get("content-type"), start: (await r.text()).slice(0, 60) }; });
ok("CSV export downloads", csv.status === 200 && csv.type.startsWith("text/csv"), JSON.stringify(csv));
const xlsx = await page.evaluate(async () => { const r = await fetch("/api/companies/demo/reporting/customer-aging/export?format=xlsx"); return { status: r.status, type: r.headers.get("content-type"), bytes: (await r.arrayBuffer()).byteLength }; });
ok("Excel export downloads", xlsx.status === 200 && xlsx.bytes > 1000, JSON.stringify(xlsx));

ok("no page errors", errors.length === 0, errors.slice(0, 5).join(" | "));
console.log(`\n${results.filter((r) => r.pass).length}/${results.length} passed`);
await browser.close();
