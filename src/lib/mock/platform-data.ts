/**
 * Placeholder data for the Platform Workspace shell. Replace with real
 * Supabase queries (companies, memberships, activity_log, notifications
 * tables) once the platform schema exists — see ARCHITECTURE.md's
 * "Known Gap" note. Subscription/billing data is no longer mocked here
 * — `platform/page.tsx` now reads real per-company subscriptions via
 * `billing-platform/`; its own Preview Mode fallback lives in
 * `src/lib/mock/billing-data.ts`.
 */

export type CompanyStatus = "active" | "needs-attention" | "onboarding";

export type MockCompany = {
  id: string;
  name: string;
  industry: string;
  status: CompanyStatus;
  openTransactions: number;
  lastActivity: string;
};

export const MOCK_COMPANIES: MockCompany[] = [
  { id: "co_1", name: "Fenwick & Rowe Ltd", industry: "Professional Services", status: "active", openTransactions: 12, lastActivity: "2 hours ago" },
  { id: "co_2", name: "Harlow Retail Group", industry: "Retail", status: "needs-attention", openTransactions: 47, lastActivity: "Yesterday" },
  { id: "co_3", name: "Netherfield Logistics", industry: "Transport", status: "active", openTransactions: 3, lastActivity: "3 days ago" },
  { id: "co_4", name: "Bramwell Dental Practice", industry: "Healthcare", status: "onboarding", openTransactions: 0, lastActivity: "Not started" },
];

export type MockActivity = {
  id: string;
  actor: string;
  action: string;
  target: string;
  timestamp: string;
};

export const MOCK_ACTIVITY: MockActivity[] = [
  { id: "act_1", actor: "You", action: "resolved 6 merchant rules in", target: "Harlow Retail Group", timestamp: "2 hours ago" },
  { id: "act_2", actor: "Priya Shah", action: "imported a bank statement into", target: "Fenwick & Rowe Ltd", timestamp: "5 hours ago" },
  { id: "act_3", actor: "You", action: "invited", target: "d.osei@netherfield.co", timestamp: "Yesterday" },
  { id: "act_4", actor: "System", action: "completed onboarding step 2 for", target: "Bramwell Dental Practice", timestamp: "2 days ago" },
];

export type MockNotification = {
  id: string;
  tone: "info" | "warn" | "good";
  message: string;
  timestamp: string;
};

export const MOCK_NOTIFICATIONS: MockNotification[] = [
  { id: "not_1", tone: "warn", message: "47 transactions in Harlow Retail Group have been unreconciled for over 14 days.", timestamp: "1 hour ago" },
  { id: "not_2", tone: "good", message: "Bank feed reconnected for Netherfield Logistics.", timestamp: "Yesterday" },
  { id: "not_3", tone: "info", message: "Your Professional plan renews on 14 August 2026.", timestamp: "2 days ago" },
];

