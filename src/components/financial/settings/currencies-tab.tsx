"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeadCell, TableRow } from "@/components/ui/table";
import type { CompanyCurrency, Currency } from "@/server/company-management/types";

export function CurrenciesTab({
  companyId,
  currencies,
  companyCurrencies,
  baseCurrencyCode,
  previewMode,
}: {
  companyId: string;
  currencies: Currency[];
  companyCurrencies: CompanyCurrency[];
  baseCurrencyCode: string;
  previewMode: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const enabledByCode = new Map(companyCurrencies.map((c) => [c.currencyCode, c.isActive]));
  const disabledTitle = previewMode ? "Available once a production Supabase project is connected" : undefined;

  async function toggle(currencyCode: string, isActive: boolean) {
    setLoading(currencyCode);
    setError(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/currencies`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currencyCode, isActive }),
      });
      if (!res.ok) {
        const body = await res.json();
        setError(body.error ?? `Request failed (${res.status})`);
        return;
      }
      router.refresh();
    } catch {
      setError("Couldn't reach the API. Check the dev server is running.");
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-vf-ink-soft">
        Base currency: <span className="font-medium text-vf-ink">{baseCurrencyCode}</span> (set from Company
        Details). Enable additional currencies this company transacts in below — for whenever foreign-currency
        bank accounts are supported.
      </p>
      <Table>
        <TableHead>
          <tr>
            <TableHeadCell>Code</TableHeadCell>
            <TableHeadCell>Name</TableHeadCell>
            <TableHeadCell>Symbol</TableHeadCell>
            <TableHeadCell>Enabled</TableHeadCell>
          </tr>
        </TableHead>
        <TableBody>
          {currencies.map((currency) => {
            const isBase = currency.code === baseCurrencyCode;
            const isEnabled = isBase || (enabledByCode.get(currency.code) ?? false);
            return (
              <TableRow key={currency.code}>
                <TableCell className="font-mono font-medium text-vf-ink">{currency.code}</TableCell>
                <TableCell>{currency.name}</TableCell>
                <TableCell>{currency.symbol}</TableCell>
                <TableCell>
                  {isBase ? (
                    <Badge tone="info">Base Currency</Badge>
                  ) : (
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={isEnabled}
                        disabled={loading === currency.code || previewMode}
                        title={disabledTitle}
                        onChange={() => toggle(currency.code, !isEnabled)}
                      />
                      {isEnabled ? "Enabled" : "Disabled"}
                    </label>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {error && <p className="text-sm text-vf-danger">{error}</p>}
    </div>
  );
}
