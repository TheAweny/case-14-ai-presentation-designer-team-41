# engine.export

Writes the slide IR out as .pptx on top of the uploaded template, and converts that file to .pdf.

- Can import: `engine.contracts`, python-pptx, the standard library.
- Must not import: any other engine layer, any model client.
- HTML export is not here: it is produced on the TypeScript side by `@lct/slide-renderer`.
