"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { IconChevronDown, IconSearch } from "@/components/ui/icons";

export type CompanyRow = {
  id: string;
  name: string;
  industry: string | null;
  statusLabel: string;
  statusTone: "good" | "warn" | "info";
  registrationNumber: string | null;
  baseCurrencyCode: string;
};

const STATUS_CLASS: Record<CompanyRow["statusTone"], string> = {
  info: "bg-[#0e47af] text-white",
  good: "bg-[#0f6b42] text-[#c9f7df]",
  warn: "bg-[#7a4a0c] text-[#ffe3b3]",
};

// Destinations are the company's existing module pages — the menu only
// shortens the path to them; access is still enforced by each page.
const OPEN_TARGETS = [
  { label: "Dashboard", path: "dashboard" },
  { label: "Bank Accounts", path: "bank-accounts" },
  { label: "Import Centre", path: "import-centre" },
  { label: "Company Settings", path: "settings" },
];

/** "My Companies" panel body from the Platform Workspace reference: a
 * search box over the user's own (already access-filtered) company list,
 * and a per-row "Open" menu. Filtering is purely client-side over rows
 * the server already returned — no new query. */
export function CompanyTable({ companies }: { companies: CompanyRow[] }) {
  const [query, setQuery] = useState("");
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return companies;
    return companies.filter((c) => [c.name, c.industry ?? "", c.registrationNumber ?? ""].some((v) => v.toLowerCase().includes(q)));
  }, [companies, query]);

  return (
    <div>
      <div className="-mt-12 mb-4 flex justify-end">
        <label className="relative w-full max-w-[300px]">
          <span className="sr-only">Search companies</span>
          <IconSearch className="pointer-events-none absolute top-1/2 left-4 h-4.5 w-4.5 -translate-y-1/2 text-[#c9d4e3]" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search companies..."
            className="h-11 w-full rounded-[10px] border border-[#29405c] bg-[#081723] pr-4 pl-11 text-sm text-white outline-none placeholder:text-[#9fb0c6] focus:border-[#2f9bff]"
          />
        </label>
      </div>

      <div className="relative overflow-x-auto rounded-[10px] border border-[#243a55]">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="bg-[#1a2d41] text-[0.72rem] font-semibold tracking-[0.06em] text-[#c9d4e3] uppercase">
            <tr>
              <th className="border-r border-[#2b4260] px-4 py-3.5">Company</th>
              <th className="border-r border-[#2b4260] px-4 py-3.5">Industry</th>
              <th className="border-r border-[#2b4260] px-4 py-3.5">Status</th>
              <th className="border-r border-[#2b4260] px-4 py-3.5">Registration No.</th>
              <th className="border-r border-[#2b4260] px-4 py-3.5">Base Currency</th>
              <th className="px-4 py-3.5">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-[#9fb0c6]">
                  No companies match &ldquo;{query}&rdquo;.
                </td>
              </tr>
            ) : (
              filtered.map((company) => (
                <tr key={company.id} className="border-t border-[#1d3049] bg-[#0a1726]">
                  <td className="px-4 py-3.5 font-medium text-white">{company.name}</td>
                  <td className="px-4 py-3.5 text-[#e6ecf5]">{company.industry || "—"}</td>
                  <td className="px-4 py-3.5">
                    <span className={cn("inline-flex rounded-full px-3.5 py-1 text-xs font-medium", STATUS_CLASS[company.statusTone])}>{company.statusLabel}</span>
                  </td>
                  <td className="px-4 py-3.5 text-[#e6ecf5]">{company.registrationNumber || "—"}</td>
                  <td className="px-4 py-3.5 text-[#e6ecf5]">{company.baseCurrencyCode}</td>
                  <td className="relative px-4 py-3 text-right">
                    <div className="inline-flex">
                      <Link
                        href={`/company/${company.id}/dashboard`}
                        className="flex h-9 items-center rounded-l-full border border-r-0 border-[#5a7593] px-5 text-sm font-medium text-white transition hover:border-[#2f9bff]"
                      >
                        Open
                      </Link>
                      <button
                        type="button"
                        aria-label={`More ways to open ${company.name}`}
                        aria-expanded={openMenu === company.id}
                        onClick={() => setOpenMenu((v) => (v === company.id ? null : company.id))}
                        className="flex h-9 items-center rounded-r-full border border-[#5a7593] pr-3.5 pl-2 text-white transition hover:border-[#2f9bff]"
                      >
                        <IconChevronDown className="h-4 w-4" />
                      </button>
                    </div>
                    {openMenu === company.id && (
                      <div role="menu" className="absolute top-full right-4 z-20 mt-1 w-52 rounded-[10px] border border-[#29405c] bg-[#0b1a2b] py-1.5 text-left shadow-[0_18px_40px_-12px_rgba(0,0,0,0.8)]">
                        {OPEN_TARGETS.map((target) => (
                          <Link
                            key={target.path}
                            role="menuitem"
                            href={`/company/${company.id}/${target.path}`}
                            onClick={() => setOpenMenu(null)}
                            className="block px-4 py-2 text-sm text-[#e6ecf5] hover:bg-white/6 hover:text-white"
                          >
                            {target.label}
                          </Link>
                        ))}
                      </div>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
