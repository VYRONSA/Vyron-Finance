/** `pdfjs-dist` ships this worker entry point without its own type
 * declarations for the `/legacy/build/pdf.worker.mjs` deep-import path —
 * see `src/server/import-centre/pdf-text-extraction.ts` for why this
 * specific module is imported directly. */
declare module "pdfjs-dist/legacy/build/pdf.worker.mjs" {
  export const WorkerMessageHandler: unknown;
}
