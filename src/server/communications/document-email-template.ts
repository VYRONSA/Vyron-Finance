/**
 * Phase 24B — pure HTML construction for branded Invoice/Statement
 * emails. Inline styles only (email clients don't load external/Tailwind
 * stylesheets) — a simplified, email-safe rendering of the same visual
 * language `DocumentBrandingHeader`/`InvoiceDocument`/`StatementDocument`
 * already establish (paper white background, the same red accent used
 * throughout VYRON, plain readable typography), not a literal reuse of
 * their JSX (which targets a browser DOM, not an email client). No
 * accounting figures are computed here — every number is a plain
 * pass-through of an already-computed value the caller supplies.
 */

import type { Company } from "@/server/company-management/types";

export type DocumentEmailBranding = { logoDataUri: string | null };

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function money(value: number): string {
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Only real, populated company fields — omitted, never a placeholder,
 * exactly like `DocumentBrandingHeader`'s own discipline. */
function companyHeaderHtml(company: Company, branding: DocumentEmailBranding): string {
  const contactParts: string[] = [];
  if (company.telephone) contactParts.push(`Tel: ${escapeHtml(company.telephone)}`);
  if (company.email) contactParts.push(escapeHtml(company.email));
  if (company.website) contactParts.push(escapeHtml(company.website));
  const contactLine = contactParts.join(" &nbsp;|&nbsp; ");

  const logo = branding.logoDataUri
    ? `<img src="${branding.logoDataUri}" alt="${escapeHtml(company.tradingName || company.name)} logo" height="48" style="height:48px;max-width:220px;object-fit:contain;" />`
    : "";

  return `
    <tr>
      <td style="padding:0 0 20px 0;border-bottom:2px solid #e5322d;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
          <td style="vertical-align:top;">
            <div style="font-size:18px;font-weight:600;color:#1a1a1a;">${escapeHtml(company.tradingName || company.name)}</div>
            ${company.vatNumber ? `<div style="font-size:12px;color:#6b6b6b;margin-top:2px;">VAT No: ${escapeHtml(company.vatNumber)}</div>` : ""}
            ${contactLine ? `<div style="font-size:12px;color:#6b6b6b;margin-top:2px;">${contactLine}</div>` : ""}
          </td>
          ${logo ? `<td style="text-align:right;vertical-align:top;">${logo}</td>` : ""}
        </tr></table>
      </td>
    </tr>`;
}

function shell(company: Company, branding: DocumentEmailBranding, heading: string, bodyHtml: string): string {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background-color:#f4f4f5;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;padding:24px 0;">
      <tr><td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;overflow:hidden;">
          <tr><td style="padding:28px 32px 0 32px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${companyHeaderHtml(company, branding)}</table>
          </td></tr>
          <tr><td style="padding:24px 32px 8px 32px;">
            <h1 style="margin:0 0 16px 0;font-size:16px;font-weight:600;color:#1a1a1a;">${escapeHtml(heading)}</h1>
            ${bodyHtml}
          </td></tr>
          <tr><td style="padding:20px 32px 28px 32px;border-top:1px solid #e5e5e5;margin-top:16px;">
            <p style="margin:16px 0 0 0;font-size:12px;color:#9a9a9a;">This is an automated message from ${escapeHtml(company.tradingName || company.name)}.</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

export function buildInvoiceEmailHtml(params: {
  company: Company;
  branding: DocumentEmailBranding;
  customerName: string;
  documentLabel: string;
  invoiceNumber: string;
  invoiceDate: string;
  total: number;
  outstanding: number;
}): string {
  const { company, branding, customerName, documentLabel, invoiceNumber, invoiceDate, total, outstanding } = params;
  const body = `
    <p style="margin:0 0 16px 0;font-size:14px;color:#3a3a3a;line-height:1.6;">Dear ${escapeHtml(customerName)},</p>
    <p style="margin:0 0 20px 0;font-size:14px;color:#3a3a3a;line-height:1.6;">
      Please find your ${escapeHtml(documentLabel)} attached as a PDF.
    </p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f9f9f9;border-radius:6px;margin-bottom:20px;">
      <tr><td style="padding:16px 20px;">
        <table role="presentation" width="100%" cellpadding="4" cellspacing="0" style="font-size:14px;color:#3a3a3a;">
          <tr><td style="color:#6b6b6b;">${escapeHtml(documentLabel)} Number</td><td align="right" style="font-family:monospace;">${escapeHtml(invoiceNumber)}</td></tr>
          <tr><td style="color:#6b6b6b;">Date</td><td align="right">${escapeHtml(invoiceDate)}</td></tr>
          <tr><td style="color:#6b6b6b;font-weight:600;">Total</td><td align="right" style="font-weight:600;">R ${money(total)}</td></tr>
          ${outstanding > 0 ? `<tr><td style="color:#c22b26;">Outstanding</td><td align="right" style="color:#c22b26;font-weight:600;">R ${money(outstanding)}</td></tr>` : ""}
        </table>
      </td></tr>
    </table>
    <p style="margin:0;font-size:13px;color:#6b6b6b;line-height:1.6;">📎 The full ${escapeHtml(documentLabel).toLowerCase()} is attached to this email as a PDF.</p>`;
  return shell(company, branding, `${documentLabel} ${invoiceNumber}`, body);
}

export function buildStatementEmailHtml(params: {
  company: Company;
  branding: DocumentEmailBranding;
  customerName: string;
  asOfDate: string;
  closingBalance: number;
}): string {
  const { company, branding, customerName, asOfDate, closingBalance } = params;
  const body = `
    <p style="margin:0 0 16px 0;font-size:14px;color:#3a3a3a;line-height:1.6;">Dear ${escapeHtml(customerName)},</p>
    <p style="margin:0 0 20px 0;font-size:14px;color:#3a3a3a;line-height:1.6;">
      Please find your Statement of Account attached as a PDF.
    </p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f9f9f9;border-radius:6px;margin-bottom:20px;">
      <tr><td style="padding:16px 20px;">
        <table role="presentation" width="100%" cellpadding="4" cellspacing="0" style="font-size:14px;color:#3a3a3a;">
          <tr><td style="color:#6b6b6b;">Statement Date</td><td align="right">${escapeHtml(asOfDate)}</td></tr>
          <tr><td style="color:#6b6b6b;font-weight:600;">Closing Balance</td><td align="right" style="font-weight:600;">R ${money(closingBalance)}</td></tr>
        </table>
      </td></tr>
    </table>
    <p style="margin:0;font-size:13px;color:#6b6b6b;line-height:1.6;">📎 The full statement is attached to this email as a PDF.</p>`;
  return shell(company, branding, "Statement of Account", body);
}
