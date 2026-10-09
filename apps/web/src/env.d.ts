// The PDF library ships its worker as plain JavaScript without type declarations.
declare module 'pdfjs-dist/build/pdf.worker.mjs'

// A file brought in as its text (the changelog, the example drawing).
declare module '*?raw' {
  const text: string
  export default text
}
