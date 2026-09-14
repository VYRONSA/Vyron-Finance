// Real-browser regression check for the document overlay (invoice modal)
// "jumping" defect: samples the dialog's position every animation frame
// while the pointer moves over the document, the backdrop, the far-right
// scrollbar edge and after scrolling, and fails if it ever moves.
//
// Run against a Preview-Mode dev server (mock data only, never Supabase):
//   NEXT_PUBLIC_SUPABASE_URL= NEXT_PUBLIC_SUPABASE_ANON_KEY= npx next dev --webpack -p 3100
//   node scripts/verify-document-overlay-stability.mjs
// Env: BASE (default http://localhost:3100), BROWSER_PATH (Chromium/Edge).
import puppeteer from "puppeteer-core";

const BASE = process.env.BASE ?? "http://localhost:3100";
const EDGE = process.env.BROWSER_PATH ?? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const browser = await puppeteer.launch({ executablePath: EDGE, headless: true, defaultViewport: { width: 1440, height: 900 } });
const page = await browser.newPage();
await page.goto(`${BASE}/company/demo/sales?tab=invoices`, { waitUntil: "domcontentloaded", timeout: 240000 });
await page.waitForSelector("xpath/.//button[normalize-space()='View']", { timeout: 240000 }); await new Promise((r) => setTimeout(r, 1500));
const viewButtons = await page.$$("xpath/.//button[normalize-space()='View']");
console.log("View buttons:", viewButtons.length);
await viewButtons[0].click();
await page.waitForSelector('[role="dialog"]');
await new Promise((r) => setTimeout(r, 400));

async function sample(label, x, y, frames = 60) {
  await page.mouse.move(x, y, { steps: 8 });
  const rects = await page.evaluate(async (n) => {
    const out = [];
    for (let i = 0; i < n; i++) {
      await new Promise((r) => requestAnimationFrame(r));
      const d = document.querySelector('[role="dialog"]');
      const r = d.getBoundingClientRect();
      const overlay = d.parentElement.getBoundingClientRect();
      // Find the nearest ancestor that creates a containing block for fixed descendants.
      let cb = null;
      for (let el = d.parentElement.parentElement; el && el !== document.body; el = el.parentElement) {
        const cs = getComputedStyle(el);
        if (cs.transform !== "none" || cs.translate !== "none" || cs.filter !== "none" || cs.backdropFilter !== "none" || cs.contain.includes("paint")) { cb = el.className.slice(0, 60); break; }
      }
      out.push({ dialogLeft: Math.round(r.left), dialogTop: Math.round(r.top), overlayW: Math.round(overlay.width), overlayH: Math.round(overlay.height), overlayLeft: Math.round(overlay.left), cb });
    }
    return out;
  }, frames);
  const distinct = new Set(rects.map((r) => `${r.dialogLeft},${r.dialogTop},${r.overlayW}x${r.overlayH}@${r.overlayLeft}`));
  const cbs = new Set(rects.map((r) => r.cb));
  console.log(`${label.padEnd(34)} distinct positions over ${frames} frames: ${distinct.size}  ${[...distinct].slice(0, 4).join(" | ")}  containingBlockAncestor=${[...cbs].join(" / ")}`);
  return distinct.size;
}

let worst = 0;
worst = Math.max(worst, await sample("centre of document", 720, 450));
worst = Math.max(worst, await sample("over Print button", ...(await centreOf("xpath/.//button[normalize-space()='Print']"))));
worst = Math.max(worst, await sample("right side of backdrop", 1380, 450));
worst = Math.max(worst, await sample("far right edge / scrollbar", 1436, 450));
worst = Math.max(worst, await sample("left backdrop", 60, 450));
await page.mouse.wheel({ deltaY: 400 });
worst = Math.max(worst, await sample("after scroll, right side", 1400, 600));

async function centreOf(sel) {
  const el = await page.$(sel);
  const b = await el.boundingBox();
  return [b.x + b.width / 2, b.y + b.height / 2];
}

// Print / Download / Close still wired
const hasDownload = await page.$("xpath/.//a[normalize-space()='Download PDF']");
console.log("Download PDF href:", hasDownload ? await page.evaluate((a) => a.getAttribute("href"), hasDownload) : null);
const printRoot = await page.evaluate(() => !!document.getElementById("document-preview-printable"));
console.log("printable root present:", printRoot);
const dialogParent = await page.evaluate(() => document.querySelector('[role="dialog"]').parentElement.parentElement.tagName);
console.log("overlay mounted under:", dialogParent);
await page.keyboard.press("Escape");
await new Promise((r) => setTimeout(r, 200));
console.log("closed via Escape:", !(await page.$('[role="dialog"]')));
console.log(worst > 1 ? "RESULT: UNSTABLE (layout jumps reproduced)" : "RESULT: STABLE");
await browser.close();
