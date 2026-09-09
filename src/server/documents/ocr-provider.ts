/**
 * OCR metadata EXTENSION POINT — mirrors `virus-scanner.ts` exactly.
 * The default provider honestly marks every document `"skipped"`, never
 * fabricates extracted text/fields. A real integration (a cloud OCR
 * API, Tesseract, ...) implements `OcrProvider` and is wired in at
 * `document-service.ts`'s one injection point.
 */

import type { OcrStatus } from "./types";

export type OcrResult = { status: OcrStatus; metadata: Record<string, unknown> | null };

export interface OcrProvider {
  extract(storagePath: string, mimeType: string): Promise<OcrResult>;
}

export class NoOpOcrProvider implements OcrProvider {
  async extract(): Promise<OcrResult> {
    return { status: "skipped", metadata: null };
  }
}

export const defaultOcrProvider: OcrProvider = new NoOpOcrProvider();
