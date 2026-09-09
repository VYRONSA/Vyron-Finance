/**
 * Integration Health — every entry uses the SAME status contract
 * (Connected/Last Sync/Last Error/Next Scheduled Sync/Retry Count), per
 * the directive's explicit instruction. Most of this platform's external
 * integrations are still not live (confirmed by code inspection — no
 * email/OCR/virus-scanning provider, no SARS eFiling client, no
 * accounting-package sync exists anywhere in this codebase; VAT returns
 * only carry a `submission_method` enum value naming `SARS_eFiling` as a
 * future option, nothing implements it). Each entry cites the real
 * extension point it corresponds to, honestly marked "Not Configured"
 * rather than omitted or faked as connected.
 *
 * Phase 25K — the Bank Feed entry is the one exception: FNB Direct Bank
 * Connectivity (`bank-connectivity/`) is a real, working OAuth-based
 * integration, not a stub. This function is company-agnostic (no
 * `companyId` — it's a static Operations-level list, called with no
 * argument from `operations-service.ts`), so it genuinely can't say
 * whether any specific company has connected FNB; `status` stays "Not
 * Configured" at this global level rather than claiming a connection
 * that may not exist for the company actually viewing it. The note text
 * itself must still describe reality accurately, though — it no longer
 * claims manual import is the only option.
 */

import type { IntegrationStatus } from "./types";

const notAvailable = (note: string) => ({ value: null, quality: "NotAvailable" as const, note });

export function listIntegrationHealth(): IntegrationStatus[] {
  return [
    {
      name: "Email Provider",
      connected: false,
      lastSync: notAvailable("No email provider configured — see communications/channels/email-sender.ts"),
      lastError: notAvailable("Not applicable — never attempted a connection."),
      nextScheduledSync: notAvailable("Not applicable."),
      retryCount: notAvailable("Not applicable."),
      status: "Not Configured",
    },
    {
      name: "Virus Scanning Provider",
      connected: false,
      lastSync: notAvailable("No scanning provider configured — see documents/virus-scanner.ts"),
      lastError: notAvailable("Not applicable — never attempted a connection."),
      nextScheduledSync: notAvailable("Not applicable."),
      retryCount: notAvailable("Not applicable."),
      status: "Not Configured",
    },
    {
      name: "OCR Provider",
      connected: false,
      lastSync: notAvailable("No OCR provider configured — see documents/ocr-provider.ts"),
      lastError: notAvailable("Not applicable — never attempted a connection."),
      nextScheduledSync: notAvailable("Not applicable."),
      retryCount: notAvailable("Not applicable."),
      status: "Not Configured",
    },
    {
      name: "Bank Feed (FNB Direct Connectivity)",
      connected: false,
      lastSync: notAvailable("FNB Direct Bank Connectivity is a real, working integration each company connects individually from Connected Banks; this company-agnostic view can't reflect any one company's connection status. Manual CSV/OFX/PDF statement import remains available alongside it."),
      lastError: notAvailable("Not applicable — this view tracks no specific company's connection."),
      nextScheduledSync: notAvailable("Unattended scheduled syncing requires a configured cron job calling the Scheduler — see the Automation Scheduler Cron Trigger entry below."),
      retryCount: notAvailable("Not applicable."),
      status: "Not Configured",
    },
    {
      name: "SARS eFiling",
      connected: false,
      lastSync: notAvailable("VAT returns record a submission_method value naming this option; no client implementing it exists yet."),
      lastError: notAvailable("Not applicable — never attempted a connection."),
      nextScheduledSync: notAvailable("Not applicable."),
      retryCount: notAvailable("Not applicable."),
      status: "Not Configured",
    },
    {
      name: "Automation Scheduler Cron Trigger",
      connected: false,
      lastSync: notAvailable("No Vercel Cron/pg_cron job is configured to call POST /api/automation/run-due-tasks on a schedule — the manual 'Run Scheduler Now' action is the only real trigger today."),
      lastError: notAvailable("Not applicable."),
      nextScheduledSync: notAvailable("Not applicable — no schedule is configured."),
      retryCount: notAvailable("Not applicable."),
      status: "Not Configured",
    },
  ];
}
