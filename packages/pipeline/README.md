# @lct/pipeline

The Mastra side of the product: the deck workflow, its steps and the agents built from the
registry. Every call to a model in this repository happens here — the Python engine has none.

- Can import: `@mastra/*`, `@lct/contracts`, `@lct/registry`, `@lct/engine-client`.
- Must not import: apps, `.pptx` libraries, anything that lays out or exports a document.
- Mastra is used as a library. Its own HTTP routes are never exposed; the API owns the routes.
