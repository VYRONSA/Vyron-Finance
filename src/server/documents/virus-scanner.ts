/**
 * Virus scanning EXTENSION POINT — a real, pluggable interface, not a
 * fabricated "everything is clean" claim. The default implementation
 * honestly marks every upload `"skipped"` (no scanner configured) —
 * never `"clean"`, since this platform has not actually scanned
 * anything. A real integration (ClamAV, a cloud AV API, ...) implements
 * `VirusScanner` and is wired in at `document-service.ts`'s one
 * injection point; nothing else in the Document Platform needs to
 * change when that happens.
 */

import type { VirusScanStatus } from "./types";

export type VirusScanResult = { status: VirusScanStatus; reason: string };

export interface VirusScanner {
  scan(storagePath: string, mimeType: string, sizeBytes: number): Promise<VirusScanResult>;
}

/** The only scanner wired in today. Honest by construction — it cannot
 * return "clean", because it never actually scanned anything. */
export class NoOpVirusScanner implements VirusScanner {
  async scan(): Promise<VirusScanResult> {
    return { status: "skipped", reason: "No virus scanning provider is configured for this deployment." };
  }
}

export const defaultVirusScanner: VirusScanner = new NoOpVirusScanner();
