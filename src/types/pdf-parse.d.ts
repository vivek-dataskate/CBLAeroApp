// Note: code imports 'pdf-parse/lib/pdf-parse.js' directly (not the
// package entry point) to avoid SSR issues with pdf-parse v1's default
// export which depends on DOMMatrix/Canvas in test environments.
declare module 'pdf-parse/lib/pdf-parse.js' {
  function pdfParse(dataBuffer: Buffer): Promise<{ text: string }>;
  export = pdfParse;
}

declare module 'pdf-parse' {
  interface PdfParseResult {
    numpages: number;
    numrender: number;
    info: Record<string, unknown>;
    metadata: Record<string, unknown>;
    text: string;
  }

  function pdfParse(dataBuffer: Buffer): Promise<PdfParseResult>;
  export = pdfParse;
}
