# engine.dataset

Reads the tables of the files people bring (CSV, TSV, XLSX, JSON, text tables) into one typed,
unabridged shape: every cell with its reference, the text as the file held it and, only where the
text allows one reading, a value. No model calls, no interpretation of what a table means.

- Can import: `engine.contracts`, the standard library, `pydantic`.
- Must not import: any other engine layer, any model client.
- A file that cannot be read gives a diagnostic and no sheets; a file too large is refused whole.
- `models.py` is a provisional contract, to be generated from the shared contracts when they exist.
