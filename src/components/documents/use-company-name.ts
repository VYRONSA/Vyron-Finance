"use client";

import { useEffect, useState } from "react";

/** Phase 24B — a minimal, display-only company name for the "Send
 * Email" confirm panel (`SendDocumentEmailAction`'s "From" field).
 * Deliberately its own tiny fetch of the SAME existing
 * `GET /api/companies/{companyId}` route `DocumentBrandingHeader`
 * already calls, rather than threading a new prop through
 * `InvoiceDocument`/`StatementDocument` into `DocumentBrandingHeader` —
 * the two components' data needs are genuinely independent (one needs
 * the full `Company` record for the printed header, this one needs only
 * a display string for a confirm dialog), and the browser's own fetch
 * cache means this rarely costs a second real network round trip. */
export function useCompanyName(companyId: string): string | null {
  const [name, setName] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/companies/${companyId}`)
      .then((res) => (res.ok ? res.json() : { company: null }))
      .then((body) => {
        if (cancelled) return;
        setName(body.company ? body.company.tradingName || body.company.name : null);
      });
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  return name;
}
