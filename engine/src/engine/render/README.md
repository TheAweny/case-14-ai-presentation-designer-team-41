# engine.render

Rasterises a presentation to PNG by driving LibreOffice, for previews and for the visual checks.

- Can import: `engine.contracts`, the standard library, LibreOffice as a subprocess.
- Must not import: any other engine layer, any model client.
- Only free fonts are installed in the image; a template's own fonts are taken from the file.
