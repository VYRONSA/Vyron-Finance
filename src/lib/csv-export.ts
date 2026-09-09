/**
 * Small shared client-side CSV export helper — Finding #046 needed this
 * in three new places (Report Designer, Management Reports, Financial
 * Statements) rather than the one `report-viewer.tsx` already had it
 * duplicated in (Finding #052's own precedent), so it's a real shared
 * util here rather than a fourth copy-paste.
 */

function csvField(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function downloadCsv(filename: string, headers: string[], rows: string[][]): void {
  const lines = [headers.map(csvField).join(","), ...rows.map((r) => r.map(csvField).join(","))];
  const blob = new Blob([lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
