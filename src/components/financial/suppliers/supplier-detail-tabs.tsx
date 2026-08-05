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
import type { ImportedBill, Supplier } from "@/server/accounting/types";
import type { SupplierAddress, SupplierAddressType, SupplierContact } from "@/server/supplier-management/types";
import type { SupplierFinancialSummary, SupplierIntelligenceSignal } from "@/server/services/supplier-financial-service";

const TABS = ["Overview", "Contacts", "Addresses", "Age Analysis", "Purchase History", "Documents", "Intelligence"] as const;
type Tab = (typeof TABS)[number];
const ADDRESS_TYPES: SupplierAddressType[] = ["Billing", "Delivery", "Postal", "Physical"];

function money(value: number): string {
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function EditSupplierOverviewForm({ companyId, supplier, onDone }: { companyId: string; supplier: Supplier; onDone: () => void }) {
  const router = useRouter();
  const [values, setValues] = useState({
    name: supplier.name,
    supplierCategory: supplier.supplierCategory,
    defaultGlAccount: supplier.defaultGlAccount ?? "",
    defaultVatCode: supplier.defaultVatCode ?? "",
    vatNumber: supplier.vatNumber,
    taxNumber: supplier.taxNumber,
    bankName: supplier.bankName,
    bankAccountNumber: supplier.bankAccountNumber,
    bankBranchCode: supplier.bankBranchCode,
    paymentTermsDays: String(supplier.paymentTermsDays),
    reason: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const bankingChanged =
    values.bankName !== supplier.bankName || values.bankAccountNumber !== supplier.bankAccountNumber || values.bankBranchCode !== supplier.bankBranchCode;

  function set<K extends keyof typeof values>(key: K, value: string) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  async function handleSave() {
    setError(null);
    if (!values.name.trim()) return setError("Supplier Name cannot be empty.");
    setLoading(true);
    try {
      const res = await fetch(`/api/companies/${companyId}/suppliers/${supplier.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: values.name.trim(),
          supplierCategory: values.supplierCategory,
          defaultGlAccount: values.defaultGlAccount || null,
          defaultVatCode: values.defaultVatCode || null,
          vatNumber: values.vatNumber,
          taxNumber: values.taxNumber,
          bankName: values.bankName,
          bankAccountNumber: values.bankAccountNumber,
          bankBranchCode: values.bankBranchCode,
          paymentTermsDays: Number(values.paymentTermsDays) || 0,
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
        <Field label="Company Name" htmlFor="edit-s-name">
          <Input id="edit-s-name" value={values.name} onChange={(e) => set("name", e.target.value)} />
        </Field>
        <Field label="Category" htmlFor="edit-s-category">
          <Input id="edit-s-category" value={values.supplierCategory} onChange={(e) => set("supplierCategory", e.target.value)} />
        </Field>
        <Field label="Default GL Account" htmlFor="edit-s-gl">
          <Input id="edit-s-gl" value={values.defaultGlAccount} onChange={(e) => set("defaultGlAccount", e.target.value)} />
        </Field>
        <Field label="Default VAT Code" htmlFor="edit-s-vatcode">
          <Input id="edit-s-vatcode" value={values.defaultVatCode} onChange={(e) => set("defaultVatCode", e.target.value)} />
        </Field>
        <Field label="VAT Number" htmlFor="edit-s-vat">
          <Input id="edit-s-vat" value={values.vatNumber} onChange={(e) => set("vatNumber", e.target.value)} />
        </Field>
        <Field label="Tax Number" htmlFor="edit-s-tax">
          <Input id="edit-s-tax" value={values.taxNumber} onChange={(e) => set("taxNumber", e.target.value)} />
        </Field>
        <Field label="Payment Terms (days)" htmlFor="edit-s-terms">
          <Input id="edit-s-terms" type="number" value={values.paymentTermsDays} onChange={(e) => set("paymentTermsDays", e.target.value)} />
        </Field>
      </div>

      <div className={cn("rounded-lg border p-4", bankingChanged ? "border-vf-warning/25 bg-vf-warning/8" : "border-vf-paper-border bg-vf-paper-alt")}>
        <p className="mb-3 text-xs font-semibold tracking-wide text-vf-ink-faint uppercase">Banking Details</p>
        <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-3">
          <Field label="Bank" htmlFor="edit-s-bankname">
            <Input id="edit-s-bankname" value={values.bankName} onChange={(e) => set("bankName", e.target.value)} />
          </Field>
          <Field label="Bank Account Number" htmlFor="edit-s-bankacc">
            <Input id="edit-s-bankacc" value={values.bankAccountNumber} onChange={(e) => set("bankAccountNumber", e.target.value)} />
          </Field>
          <Field label="Bank Branch Code" htmlFor="edit-s-branch">
            <Input id="edit-s-branch" value={values.bankBranchCode} onChange={(e) => set("bankBranchCode", e.target.value)} />
          </Field>
        </div>
        {bankingChanged && (
          <p className="mt-2 text-xs text-vf-ink-faint">
            Changing banking details requires Purchasing Manager approval or higher, since it affects where a real
            payment run sends funds.
          </p>
        )}
      </div>

      <Field label="Reason for change (recommended)" htmlFor="edit-s-reason">
        <Input id="edit-s-reason" value={values.reason} onChange={(e) => set("reason", e.target.value)} placeholder="e.g. Supplier confirmed new banking details" />
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

function OverviewTab({ companyId, supplier, contacts, financialSummary, previewMode }: { companyId: string; supplier: Supplier; contacts: SupplierContact[]; financialSummary: SupplierFinancialSummary; previewMode: boolean }) {
  const [isEditing, setIsEditing] = useState(false);
  const primaryContact = contacts.find((c) => c.isPrimary) ?? contacts[0];
  const rows: [string, string][] = [
    ["Supplier Type", supplier.supplierType],
    ["Category", supplier.supplierCategory || "—"],
    ["Default GL Account", supplier.defaultGlAccount || "—"],
    ["Default VAT Code", supplier.defaultVatCode || "—"],
    ["VAT Number", supplier.vatNumber || "—"],
    ["Tax Number", supplier.taxNumber || "—"],
    ["Bank", supplier.bankName || "—"],
    ["Bank Account Number", supplier.bankAccountNumber || "—"],
    ["Bank Branch Code", supplier.bankBranchCode || "—"],
    ["Payment Terms", `${supplier.paymentTermsDays} days`],
    ["Alternative Names", supplier.alternativeNames.join(", ") || "—"],
  ];

  if (isEditing) {
    return (
      <div className="flex flex-col gap-6">
        <EditSupplierOverviewForm companyId={companyId} supplier={supplier} onDone={() => setIsEditing(false)} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-vf-ink-faint">Supplier Details</p>
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
      </dl>

      <div className="flex flex-wrap gap-2 border-t border-vf-paper-border pt-4">
        <SendCommunicationButton
          companyId={companyId}
          module="Purchasing"
          businessObjectType="Supplier"
          businessObjectId={supplier.id}
          templateCode="SupplierStatement"
          recipients={[{ type: "Supplier", id: supplier.id, name: supplier.name, address: primaryContact?.email || null }]}
          variables={{ supplierName: supplier.name, outstandingBalance: financialSummary.outstandingBalance.toFixed(2) }}
          attachableEntityType="Supplier"
          attachableEntityId={supplier.id}
          previewMode={previewMode}
          buttonLabel="Send Statement"
        />
      </div>

      <div className="border-t border-vf-paper-border pt-4">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-vf-ink-faint">Communications</p>
        <CommunicationHistoryPanel companyId={companyId} businessObjectType="Supplier" businessObjectId={supplier.id} previewMode={previewMode} />
      </div>
    </div>
  );
}

function ContactsTab({ companyId, supplierId, contacts, previewMode }: { companyId: string; supplierId: number; contacts: SupplierContact[]; previewMode: boolean }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [position, setPosition] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const apiBase = `/api/companies/${companyId}/suppliers/${supplierId}/contacts`;
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
          <Field label="Name" htmlFor="s-contact-name" required>
            <Input id="s-contact-name" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
        </div>
        <div className="min-w-[180px]">
          <Field label="Email" htmlFor="s-contact-email">
            <Input id="s-contact-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
        </div>
        <div className="w-40">
          <Field label="Phone" htmlFor="s-contact-phone">
            <Input id="s-contact-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
        </div>
        <div className="w-40">
          <Field label="Position" htmlFor="s-contact-position">
            <Input id="s-contact-position" value={position} onChange={(e) => setPosition(e.target.value)} />
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

function AddressesTab({ companyId, supplierId, addresses, previewMode }: { companyId: string; supplierId: number; addresses: SupplierAddress[]; previewMode: boolean }) {
  const router = useRouter();
  const [addressType, setAddressType] = useState<SupplierAddressType>("Billing");
  const [line1, setLine1] = useState("");
  const [city, setCity] = useState("");
  const [country, setCountry] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const apiBase = `/api/companies/${companyId}/suppliers/${supplierId}/addresses`;
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
              <p className="text-sm text-vf-ink-faint">{[a.city, a.region, a.postalCode, a.country].filter(Boolean).join(", ") || "—"}</p>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-end gap-2 border-t border-vf-paper-border pt-4">
        <div className="w-36">
          <Field label="Type" htmlFor="s-addr-type">
            <Select id="s-addr-type" value={addressType} onChange={(e) => setAddressType(e.target.value as SupplierAddressType)}>
              {ADDRESS_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="min-w-[200px] flex-1">
          <Field label="Address Line 1" htmlFor="s-addr-line1">
            <Input id="s-addr-line1" value={line1} onChange={(e) => setLine1(e.target.value)} />
          </Field>
        </div>
        <div className="w-40">
          <Field label="City" htmlFor="s-addr-city">
            <Input id="s-addr-city" value={city} onChange={(e) => setCity(e.target.value)} />
          </Field>
        </div>
        <div className="w-36">
          <Field label="Country" htmlFor="s-addr-country">
            <Input id="s-addr-country" value={country} onChange={(e) => setCountry(e.target.value)} />
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

function AgeAnalysisTab({ summary }: { summary: SupplierFinancialSummary }) {
  const buckets: [string, number][] = [
    ["Current", summary.aging.current],
    ["30 Days", summary.aging.days30],
    ["60 Days", summary.aging.days60],
    ["90 Days", summary.aging.days90],
    ["120+ Days", summary.aging.days120Plus],
  ];
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div><p className="text-xs text-vf-ink-faint">Outstanding Balance</p><p className="mt-1 font-mono text-lg font-semibold tabular-nums">{money(summary.outstandingBalance)}</p></div>
        <div><p className="text-xs text-vf-ink-faint">Lifetime Purchases</p><p className="mt-1 font-mono text-lg font-semibold tabular-nums">{money(summary.lifetimePurchases)}</p></div>
        <div><p className="text-xs text-vf-ink-faint">Open Bills</p><p className="mt-1 font-mono text-lg font-semibold tabular-nums">{summary.openBillCount}</p></div>
        <div><p className="text-xs text-vf-ink-faint">Average Payment Days</p><p className="mt-1 font-mono text-lg font-semibold tabular-nums">{summary.averagePaymentDays ?? "Not enough data yet"}</p></div>
      </div>
      <Table>
        <TableHead>
          <tr>
            {buckets.map(([label]) => (
              <TableHeadCell key={label} className="text-right">{label}</TableHeadCell>
            ))}
          </tr>
        </TableHead>
        <TableBody>
          <TableRow>
            {buckets.map(([label, value]) => (
              <TableCell key={label} className="text-right font-mono tabular-nums">{money(value)}</TableCell>
            ))}
          </TableRow>
        </TableBody>
      </Table>
    </div>
  );
}

function PurchaseHistoryTab({ bills }: { bills: ImportedBill[] }) {
  if (bills.length === 0) {
    return <EmptyState icon={<IconFileText className="h-5 w-5" />} title="No purchase history yet." description="Bills imported for this supplier will appear here." />;
  }
  return (
    <Table>
      <TableHead>
        <tr>
          <TableHeadCell>Invoice #</TableHeadCell>
          <TableHeadCell>Type</TableHeadCell>
          <TableHeadCell>Invoice Date</TableHeadCell>
          <TableHeadCell>Due Date</TableHeadCell>
          <TableHeadCell className="text-right">Total</TableHeadCell>
          <TableHeadCell className="text-right">Outstanding</TableHeadCell>
          <TableHeadCell>Status</TableHeadCell>
        </tr>
      </TableHead>
      <TableBody>
        {bills.map((b) => (
          <TableRow key={b.id}>
            <TableCell className="font-mono text-xs text-vf-ink-faint">{b.invoiceNumber}</TableCell>
            <TableCell>{b.documentType}</TableCell>
            <TableCell>{b.invoiceDate ?? "—"}</TableCell>
            <TableCell>{b.dueDate ?? "—"}</TableCell>
            <TableCell className="text-right font-mono tabular-nums">{money(b.total)}</TableCell>
            <TableCell className="text-right font-mono tabular-nums">{money(b.outstanding)}</TableCell>
            <TableCell>
              <Badge tone={b.outstanding > 0 ? "warn" : "good"}>{b.outstanding > 0 ? "Open" : "Settled"}</Badge>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function IntelligenceTab({ intelligence }: { intelligence: SupplierIntelligenceSignal[] }) {
  if (intelligence.length === 0) {
    return <EmptyState icon={<IconSparkles className="h-5 w-5" />} title="No Supplier Intelligence signals yet." description="Signals appear once this supplier has billing activity." />;
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

export function SupplierDetailTabs({
  companyId,
  supplier,
  contacts,
  addresses,
  financialSummary,
  intelligence,
  bills,
  previewMode,
}: {
  companyId: string;
  supplier: Supplier;
  contacts: SupplierContact[];
  addresses: SupplierAddress[];
  financialSummary: SupplierFinancialSummary;
  intelligence: SupplierIntelligenceSignal[];
  bills: ImportedBill[];
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
        {activeTab === "Overview" && <OverviewTab companyId={companyId} supplier={supplier} contacts={contacts} financialSummary={financialSummary} previewMode={previewMode} />}
        {activeTab === "Contacts" && <ContactsTab companyId={companyId} supplierId={supplier.id} contacts={contacts} previewMode={previewMode} />}
        {activeTab === "Addresses" && <AddressesTab companyId={companyId} supplierId={supplier.id} addresses={addresses} previewMode={previewMode} />}
        {activeTab === "Age Analysis" && <AgeAnalysisTab summary={financialSummary} />}
        {activeTab === "Purchase History" && <PurchaseHistoryTab bills={bills} />}
        {activeTab === "Documents" && <DocumentsPanel companyId={companyId} entityType="Supplier" entityId={supplier.id} previewMode={previewMode} />}
        {activeTab === "Intelligence" && <IntelligenceTab intelligence={intelligence} />}
      </CardContent>
    </Card>
  );
}
