/**
 * Integration Health — every entry uses the SAME status contract
 * (Connected/Last Sync/Last Error/Next Scheduled Sync/Retry Count), per
 * the directive's explicit instruction, even though NONE of this
 * platform's external integrations are live yet (confirmed by code
 * inspection — no bank feed API, no SARS eFiling client, no accounting-
 * package sync exists anywhere in this codebase; VAT returns only carry
 * a `submission_method` enum value naming `SARS_eFiling` as a future
 * option, nothing implements it). Each entry cites the real extension
 * point it corresponds to, honestly marked "Not Configured" rather than
 * omitted or faked as connected.
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
      name: "Bank Feed",
      connected: false,
      lastSync: notAvailable("No live bank feed integration exists — Import Centre accepts manual CSV/OFX upload only."),
      lastError: notAvailable("Not applicable — never attempted a connection."),
      nextScheduledSync: notAvailable("Not applicable."),
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
