"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeadCell, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { IconFileText, IconSparkles, IconUsers } from "@/components/ui/icons";
import { DocumentsPanel } from "@/components/financial/documents/documents-panel";
import { SendCommunicationButton } from "@/components/financial/communications/send-communication-button";
import { CommunicationHistoryPanel } from "@/components/financial/communications/communication-history-panel";
import type { AddressType, Customer, CustomerAddress, CustomerContact } from "@/server/customer-management/types";
import type { CustomerFinancialSummary, CustomerIntelligenceSignal } from "@/server/services/customer-financial-service";
import type { SalesInvoice, SalesInvoiceStatus } from "@/server/sales/types";

const TABS = ["Overview", "Contacts", "Addresses", "Financial", "Sales History", "Documents", "Intelligence"] as const;
type Tab = (typeof TABS)[number];
const ADDRESS_TYPES: AddressType[] = ["Billing", "Delivery", "Postal", "Physical"];
const INVOICE_STATUS_TONE: Record<SalesInvoiceStatus, "muted" | "info" | "good" | "danger"> = {
  Draft: "muted",
  Submitted: "info",
  Approved: "info",
  Posted: "good",
  Cancelled: "danger",
};

function money(value: number): string {
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function EditCustomerOverviewForm({ companyId, customer, onDone }: { companyId: string; customer: Customer; onDone: () => void }) {
  const router = useRouter();
  const [values, setValues] = useState({
    name: customer.name,
    customerGroup: customer.customerGroup,
    industry: customer.industry,
    vatNumber: customer.vatNumber,
    registrationNumber: customer.registrationNumber,
    creditLimit: String(customer.creditLimit),
    paymentTermsDays: String(customer.paymentTermsDays),
    priceList: customer.priceList,
    salesRep: customer.salesRep,
    notes: customer.notes,
    reason: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const creditLimitChanged = Number(values.creditLimit) !== customer.creditLimit;

  function set<K extends keyof typeof values>(key: K, value: string) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  async function handleSave() {
    setError(null);
    if (!values.name.trim()) return setError("Customer Name cannot be empty.");
    setLoading(true);
    try {
      const res = await fetch(`/api/companies/${companyId}/customers/${customer.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: values.name.trim(),
          customerGroup: values.customerGroup,
          industry: values.industry,
          vatNumber: values.vatNumber,
          registrationNumber: values.registrationNumber,
          creditLimit: Number(values.creditLimit) || 0,
          paymentTermsDays: Number(values.paymentTermsDays) || 0,
          priceList: values.priceList,
          salesRep: values.salesRep,
          notes: values.notes,
          reason: values.reason.trim(),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? `Request failed (${res.status})`);
        return;
      }
      router.refresh();
      onDone();
    } catch {
      setError("Couldn't reach the API. Check the dev server is running.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Company Name" htmlFor="edit-name">
          <Input id="edit-name" value={values.name} onChange={(e) => set("name", e.target.value)} />
        </Field>
        <Field label="Customer Group" htmlFor="edit-group">
          <Input id="edit-group" value={values.customerGroup} onChange={(e) => set("customerGroup", e.target.value)} />
        </Field>
        <Field label="Industry" htmlFor="edit-industry">
          <Input id="edit-industry" value={values.industry} onChange={(e) => set("industry", e.target.value)} />
        </Field>
        <Field label="VAT Number" htmlFor="edit-vat">
          <Input id="edit-vat" value={values.vatNumber} onChange={(e) => set("vatNumber", e.target.value)} />
        </Field>
        <Field label="Registration Number" htmlFor="edit-reg">
          <Input id="edit-reg" value={values.registrationNumber} onChange={(e) => set("registrationNumber", e.target.value)} />
        </Field>
        <Field label="Credit Limit" htmlFor="edit-credit" className={creditLimitChanged ? "rounded-lg bg-vf-warning/8 p-2" : undefined}>
          <Input id="edit-credit" type="number" step="0.01" value={values.creditLimit} onChange={(e) => set("creditLimit", e.target.value)} />
          {creditLimitChanged && <p className="text-xs text-vf-ink-faint">Changing the credit limit requires Sales Manager approval or higher.</p>}
        </Field>
        <Field label="Payment Terms (days)" htmlFor="edit-terms">
          <Input id="edit-terms" type="number" value={values.paymentTermsDays} onChange={(e) => set("paymentTermsDays", e.target.value)} />
        </Field>
        <Field label="Price List" htmlFor="edit-pricelist">
          <Input id="edit-pricelist" value={values.priceList} onChange={(e) => set("priceList", e.target.value)} />
        </Field>
        <Field label="Sales Representative" htmlFor="edit-salesrep">
          <Input id="edit-salesrep" value={values.salesRep} onChange={(e) => set("salesRep", e.target.value)} />
        </Field>
      </div>
      <Field label="Notes" htmlFor="edit-notes">
        <textarea
          id="edit-notes"
          value={values.notes}
          onChange={(e) => set("notes", e.target.value)}
          rows={3}
          className="w-full rounded-lg border border-vf-paper-border bg-vf-paper px-3.5 py-2.5 text-vf-ink outline-none focus:border-vf-red-500"
        />
      </Field>
      <Field label="Reason for change (recommended)" htmlFor="edit-reason">
        <Input id="edit-reason" value={values.reason} onChange={(e) => set("reason", e.target.value)} placeholder="e.g. Corrected after client confirmation" />
      </Field>
      {error && (
        <p role="alert" className="rounded-lg border border-vf-danger/25 bg-vf-danger/8 px-3.5 py-2.5 text-sm text-vf-danger">
          {error}
        </p>
      )}
      <div className="flex gap-3">
        <Button type="button" variant="primary" size="sm" disabled={loading} onClick={handleSave}>
          {loading ? "Saving…" : "Save Changes"}
        </Button>
        <Button type="button" variant="subtle" size="sm" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function OverviewTab({ companyId, customer, contacts, financialSummary, previewMode }: { companyId: string; customer: Customer; contacts: CustomerContact[]; financialSummary: CustomerFinancialSummary; previewMode: boolean }) {
  const [isEditing, setIsEditing] = useState(false);
  const primaryContact = contacts.find((c) => c.isPrimary) ?? contacts[0];
  const rows: [string, string][] = [
    ["Customer Type", customer.customerType],
    ["Customer Group", customer.customerGroup || "—"],
    ["Industry", customer.industry || "—"],
    ["VAT Number", customer.vatNumber || "—"],
    ["Registration Number", customer.registrationNumber || "—"],
    ["Credit Limit", money(customer.creditLimit)],
    ["Payment Terms", `${customer.paymentTermsDays} days`],
    ["Currency", customer.currencyCode || "—"],
    ["Price List", customer.priceList || "—"],
    ["Sales Representative", customer.salesRep || "—"],
  ];
  const overdueAmount = financialSummary.aging.days30 + financialSummary.aging.days60 + financialSummary.aging.days90 + financialSummary.aging.days120Plus;

  if (isEditing) {
    return (
      <div className="flex flex-col gap-6">
        <EditCustomerOverviewForm companyId={companyId} customer={customer} onDone={() => setIsEditing(false)} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-vf-ink-faint">Customer Details</p>
        {!previewMode && (
          <Button type="button" variant="subtle" size="sm" onClick={() => setIsEditing(true)}>
            Edit Details
          </Button>
        )}
      </div>
      <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-vf-ink-faint">{label}</dt>
            <dd className="mt-1 text-sm font-medium text-vf-ink">{value}</dd>
          </div>
        ))}
        {customer.notes && (
          <div className="sm:col-span-2 lg:col-span-3">
            <dt className="text-xs text-vf-ink-faint">Notes</dt>
            <dd className="mt-1 text-sm text-vf-ink-soft">{customer.notes}</dd>
          </div>
        )}
      </dl>

      <div className="flex flex-wrap gap-2 border-t border-vf-paper-border pt-4">
        <SendCommunicationButton
          companyId={companyId}
          module="Sales"
          businessObjectType="Customer"
          businessObjectId={customer.id}
          templateCode="PaymentReminder"
          recipients={[{ type: "Customer", id: customer.id, name: customer.name, address: primaryContact?.email || null }]}
          variables={{ recipientName: customer.name }}
          attachableEntityType="Customer"
          attachableEntityId={customer.id}
          copilotDraftUrl={`/api/companies/${companyId}/customers/${customer.id}/draft-communication`}
          previewMode={previewMode}
          buttonLabel="Send Reminder Now"
        />
        <SendCommunicationButton
          companyId={companyId}
          module="Sales"
          businessObjectType="Customer"
          businessObjectId={customer.id}
          templateCode="CustomerStatement"
          recipients={[{ type: "Customer", id: customer.id, name: customer.name, address: primaryContact?.email || null }]}
          variables={{
            customerName: customer.name,
            outstandingBalance: financialSummary.outstandingBalance.toFixed(2),
            overdueAmount: overdueAmount.toFixed(2),
          }}
          attachableEntityType="Customer"
          attachableEntityId={customer.id}
          previewMode={previewMode}
          buttonLabel="Send Statement"
        />
      </div>

      <div className="border-t border-vf-paper-border pt-4">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-vf-ink-faint">Communications</p>
        <CommunicationHistoryPanel companyId={companyId} businessObjectType="Customer" businessObjectId={customer.id} previewMode={previewMode} />
      </div>
    </div>
  );
}

function ContactsTab({ companyId, customerId, contacts, previewMode }: { companyId: string; customerId: number; contacts: CustomerContact[]; previewMode: boolean }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [position, setPosition] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const apiBase = `/api/companies/${companyId}/customers/${customerId}/contacts`;
  const disabledTitle = previewMode ? "Available once a production Supabase project is connected" : undefined;

  async function handleAdd() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(apiBase, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, email, phone, position }) });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Request failed (${res.status})`);
        return;
      }
      setName("");
      setEmail("");
      setPhone("");
      setPosition("");
      router.refresh();
    } catch {
      setError("Couldn't reach the API. Check the dev server is running.");
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(contactId: number) {
    setLoading(true);
    try {
      await fetch(`${apiBase}/${contactId}`, { method: "DELETE" });
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {contacts.length === 0 ? (
        <EmptyState icon={<IconUsers className="h-5 w-5" />} title="No contacts yet." description="Add the first contact below." />
      ) : (
        <Table>
          <TableHead>
            <tr>
              <TableHeadCell>Name</TableHeadCell>
              <TableHeadCell>Email</TableHeadCell>
              <TableHeadCell>Phone</TableHeadCell>
              <TableHeadCell>Position</TableHeadCell>
              <TableHeadCell>Primary</TableHeadCell>
              <TableHeadCell className="text-right">
                <span className="sr-only">Actions</span>
              </TableHeadCell>
            </tr>
          </TableHead>
          <TableBody>
            {contacts.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="font-medium text-vf-ink">{c.name}</TableCell>
                <TableCell>{c.email || "—"}</TableCell>
                <TableCell>{c.phone || c.mobile || "—"}</TableCell>
                <TableCell>{c.position || "—"}</TableCell>
                <TableCell>{c.isPrimary && <Badge tone="info">Primary</Badge>}</TableCell>
                <TableCell className="text-right">
                  <Button variant="subtle" size="sm" disabled={previewMode || loading} title={disabledTitle} onClick={() => handleDelete(c.id)}>
                    Remove
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <div className="flex flex-wrap items-end gap-2 border-t border-vf-paper-border pt-4">
        <div className="min-w-[160px]">
          <Field label="Name" htmlFor="contact-name" required>
            <Input id="contact-name" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
        </div>
        <div className="min-w-[180px]">
          <Field label="Email" htmlFor="contact-email">
            <Input id="contact-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
        </div>
        <div className="w-40">
          <Field label="Phone" htmlFor="contact-phone">
            <Input id="contact-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
        </div>
        <div className="w-40">
          <Field label="Position" htmlFor="contact-position">
            <Input id="contact-position" value={position} onChange={(e) => setPosition(e.target.value)} />
          </Field>
        </div>
        <Button variant="primary" size="sm" disabled={previewMode || loading || !name.trim()} title={disabledTitle} onClick={handleAdd}>
          Add Contact
        </Button>
      </div>
      {error && <p className="text-sm text-vf-danger">{error}</p>}
    </div>
  );
}

function AddressesTab({ companyId, customerId, addresses, previewMode }: { companyId: string; customerId: number; addresses: CustomerAddress[]; previewMode: boolean }) {
  const router = useRouter();
  const [addressType, setAddressType] = useState<AddressType>("Billing");
  const [line1, setLine1] = useState("");
  const [city, setCity] = useState("");
  const [country, setCountry] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const apiBase = `/api/companies/${companyId}/customers/${customerId}/addresses`;
  const disabledTitle = previewMode ? "Available once a production Supabase project is connected" : undefined;

  async function handleAdd() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(apiBase, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ addressType, line1, city, country }) });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Request failed (${res.status})`);
        return;
      }
      setLine1("");
      setCity("");
      setCountry("");
      router.refresh();
    } catch {
      setError("Couldn't reach the API. Check the dev server is running.");
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(addressId: number) {
    setLoading(true);
    try {
      await fetch(`${apiBase}/${addressId}`, { method: "DELETE" });
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {addresses.length === 0 ? (
        <EmptyState icon={<IconUsers className="h-5 w-5" />} title="No addresses yet." description="Add the first address below." />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {addresses.map((a) => (
            <div key={a.id} className="rounded-vf-md border border-vf-paper-border p-3">
              <div className="flex items-center justify-between">
                <Badge tone="info">{a.addressType}</Badge>
                <Button variant="subtle" size="sm" disabled={previewMode || loading} title={disabledTitle} onClick={() => handleDelete(a.id)}>
                  Remove
                </Button>
              </div>
              <p className="mt-2 text-sm text-vf-ink">
                {a.line1}
                {a.line2 && <>, {a.line2}</>}
              </p>
              <p className="text-sm text-vf-ink-faint">
                {[a.city, a.region, a.postalCode, a.country].filter(Boolean).join(", ") || "—"}
              </p>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-end gap-2 border-t border-vf-paper-border pt-4">
        <div className="w-36">
          <Field label="Type" htmlFor="addr-type">
            <Select id="addr-type" value={addressType} onChange={(e) => setAddressType(e.target.value as AddressType)}>
              {ADDRESS_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="min-w-[200px] flex-1">
          <Field label="Address Line 1" htmlFor="addr-line1">
            <Input id="addr-line1" value={line1} onChange={(e) => setLine1(e.target.value)} />
          </Field>
        </div>
        <div className="w-40">
          <Field label="City" htmlFor="addr-city">
            <Input id="addr-city" value={city} onChange={(e) => setCity(e.target.value)} />
          </Field>
        </div>
        <div className="w-36">
          <Field label="Country" htmlFor="addr-country">
            <Input id="addr-country" value={country} onChange={(e) => setCountry(e.target.value)} />
          </Field>
        </div>
        <Button variant="primary" size="sm" disabled={previewMode || loading || !line1.trim()} title={disabledTitle} onClick={handleAdd}>
          Add Address
        </Button>
      </div>
      {error && <p className="text-sm text-vf-danger">{error}</p>}
    </div>
  );
}

function FinancialTab({ summary }: { summary: CustomerFinancialSummary }) {
  const agingBuckets: [string, number][] = [
    ["Current", summary.aging.current],
    ["30 Days", summary.aging.days30],
    ["60 Days", summary.aging.days60],
    ["90 Days", summary.aging.days90],
    ["120+ Days", summary.aging.days120Plus],
  ];
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div><p className="text-xs text-vf-ink-faint">Outstanding Balance</p><p className="mt-1 font-mono text-lg font-semibold tabular-nums">{money(summary.outstandingBalance)}</p></div>
        <div><p className="text-xs text-vf-ink-faint">Lifetime Sales</p><p className="mt-1 font-mono text-lg font-semibold tabular-nums">{money(summary.lifetimeSales)}</p></div>
        <div><p className="text-xs text-vf-ink-faint">Available Credit</p><p className="mt-1 font-mono text-lg font-semibold tabular-nums">{money(summary.availableCredit)}</p></div>
        <div><p className="text-xs text-vf-ink-faint">Credit Utilisation</p><p className="mt-1 font-mono text-lg font-semibold tabular-nums">{summary.creditUtilisationPercent}%</p></div>
        <div><p className="text-xs text-vf-ink-faint">Average Payment Days</p><p className="mt-1 font-mono text-lg font-semibold tabular-nums">{summary.averagePaymentDays ?? "Not enough data yet"}</p></div>
        <div><p className="text-xs text-vf-ink-faint">Open Quotes</p><p className="mt-1 font-mono text-lg font-semibold tabular-nums">{summary.openQuotes}</p></div>
        <div><p className="text-xs text-vf-ink-faint">Open Orders</p><p className="mt-1 font-mono text-lg font-semibold tabular-nums">{summary.openOrders}</p></div>
        <div><p className="text-xs text-vf-ink-faint">Open Invoices</p><p className="mt-1 font-mono text-lg font-semibold tabular-nums">{summary.openInvoices}</p></div>
        <div><p className="text-xs text-vf-ink-faint">Gross Profit</p><p className="mt-1 text-sm font-medium text-vf-ink-faint">{summary.grossProfit ?? "Awaiting Inventory Module"}</p></div>
        <div><p className="text-xs text-vf-ink-faint">Margin</p><p className="mt-1 text-sm font-medium text-vf-ink-faint">{summary.marginPercent !== null ? `${summary.marginPercent}%` : "Awaiting Inventory Module"}</p></div>
      </div>
      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-vf-ink-faint">Age Analysis</p>
        <Table>
          <TableHead>
            <tr>
              {agingBuckets.map(([label]) => (
                <TableHeadCell key={label} className="text-right">{label}</TableHeadCell>
              ))}
            </tr>
          </TableHead>
          <TableBody>
            <TableRow>
              {agingBuckets.map(([label, value]) => (
                <TableCell key={label} className="text-right font-mono tabular-nums">{money(value)}</TableCell>
              ))}
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function SalesHistoryTab({ invoices }: { invoices: SalesInvoice[] }) {
  if (invoices.length === 0) {
    return <EmptyState icon={<IconFileText className="h-5 w-5" />} title="No sales history yet." description="Invoices, credit notes, and debit notes for this customer will appear here." />;
  }
  return (
    <Table>
      <TableHead>
        <tr>
          <TableHeadCell>Document</TableHeadCell>
          <TableHeadCell>Type</TableHeadCell>
          <TableHeadCell>Date</TableHeadCell>
          <TableHeadCell>Due Date</TableHeadCell>
          <TableHeadCell className="text-right">Total</TableHeadCell>
          <TableHeadCell className="text-right">Outstanding</TableHeadCell>
          <TableHeadCell>Status</TableHeadCell>
        </tr>
      </TableHead>
      <TableBody>
        {invoices.map((i) => (
          <TableRow key={i.id}>
            <TableCell className="font-medium text-vf-ink">{i.invoiceNumber}</TableCell>
            <TableCell>{i.documentType}</TableCell>
            <TableCell>{i.invoiceDate}</TableCell>
            <TableCell>{i.dueDate || "—"}</TableCell>
            <TableCell className="text-right font-mono tabular-nums">{money(i.total)}</TableCell>
            <TableCell className="text-right font-mono tabular-nums">{money(i.outstanding)}</TableCell>
            <TableCell><Badge tone={INVOICE_STATUS_TONE[i.status]}>{i.status}</Badge></TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function IntelligenceTab({ intelligence }: { intelligence: CustomerIntelligenceSignal[] }) {
  if (intelligence.length === 0) {
    return <EmptyState icon={<IconSparkles className="h-5 w-5" />} title="No Customer Intelligence signals yet." description="Signals appear once this customer has posted sales activity." />;
  }
  return (
    <ul className="flex flex-col gap-2">
      {intelligence.map((s, i) => (
        <li key={i} className="rounded-vf-sm border border-vf-paper-border p-3 text-sm">
          <p className="font-medium text-vf-ink">{s.message}</p>
          <p className="mt-1 text-xs text-vf-ink-faint">{s.reasoning}</p>
        </li>
      ))}
    </ul>
  );
}

export function CustomerDetailTabs({
  companyId,
  customer,
  contacts,
  addresses,
  financialSummary,
  intelligence,
  invoices,
  previewMode,
}: {
  companyId: string;
  customer: Customer;
  contacts: CustomerContact[];
  addresses: CustomerAddress[];
  financialSummary: CustomerFinancialSummary;
  intelligence: CustomerIntelligenceSignal[];
  invoices: SalesInvoice[];
  previewMode: boolean;
}) {
  const [activeTab, setActiveTab] = useState<Tab>("Overview");

  return (
    <Card>
      <div className="flex flex-wrap gap-1 border-b border-vf-paper-border px-4 pt-3">
        {TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            aria-current={activeTab === tab ? "page" : undefined}
            className={cn(
              "rounded-t-lg px-3.5 py-2 text-sm font-medium transition",
              activeTab === tab ? "border-b-2 border-vf-red-600 text-vf-red-600" : "text-vf-ink-faint hover:text-vf-ink-soft",
            )}
          >
            {tab}
          </button>
        ))}
      </div>
      <CardContent className="pt-5">
        {activeTab === "Overview" && <OverviewTab companyId={companyId} customer={customer} contacts={contacts} financialSummary={financialSummary} previewMode={previewMode} />}
        {activeTab === "Contacts" && <ContactsTab companyId={companyId} customerId={customer.id} contacts={contacts} previewMode={previewMode} />}
        {activeTab === "Addresses" && <AddressesTab companyId={companyId} customerId={customer.id} addresses={addresses} previewMode={previewMode} />}
        {activeTab === "Financial" && <FinancialTab summary={financialSummary} />}
        {activeTab === "Sales History" && <SalesHistoryTab invoices={invoices} />}
        {activeTab === "Documents" && <DocumentsPanel companyId={companyId} entityType="Customer" entityId={customer.id} previewMode={previewMode} />}
        {activeTab === "Intelligence" && <IntelligenceTab intelligence={intelligence} />}
      </CardContent>
    </Card>
  );
}
