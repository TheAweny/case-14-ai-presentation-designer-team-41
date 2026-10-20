# Brandbook ingestion and effective presentation style

## Scope and source

Implements the style-source portion of the second-stage VK Tech specification supplied on
2026-10-19: Figma files, PDF guidelines, JSON design tokens, logos, slide examples and their
packaged equivalents. Analytics/dataset interpretation is a separate feature. Uploaded
documents are data, never executable instructions.

## Architecture

Python parser adapters produce a provenance-preserving BrandbookProfile. The API stores the
original, extracted assets and validated profile with account ACL. No model is called in the
engine. Zod is authoritative and generates Pydantic. An explicit brandbook selection flows
through chat, generation, immutable recovery spec and native export. Absence preserves the
existing PPTX path.

Style precedence: explicit applicable user override (including opting for template priority),
applicable declared brandbook rule, rule inferred from the brandbook when it declares none,
template rule, identified fallback. An inferred rule is marked `inferred` with the files it came
from: brand colours are saturated paints that recur in at least two vector logos (pictures break
a tie), text is the darkest recurring neutral, headings take the main colour, and the font is
the family the brandbook ships the most files of. Observed PDF/SVG colours
and font metadata remain observations until their semantic role is established. Ambiguous or
unsupported inputs have warnings, coverage and a partial status; no fabricated extraction.

## Profile

Profile contains source digest/parser version, per-file inventory, colours and typography,
spacing/grid/layout tokens, extracted logo/image/font/example assets, textual rules, document
structure, evidence locators, warnings and coverage. Every extracted token records its source,
locator, confidence and declared/observed basis. No rule is inferred from a filename alone.

JSON supports W3C-style $type/$value tokens, Style Dictionary type/value tokens, aliases and
Figma REST document JSON. PDF processing retains pages/text, exact literal colour/font rules
and measured vectors/fonts separately; image-only pages report OCR needed. SVG parses vector
paints and viewBox without executing scripts. Raster images retain dimensions/mode/digests.
Fonts retain internal family/style metadata. PPTX examples reuse the existing document parser.
Native .fig requires actual binary decoding, not renaming JSON or treating preview.png as its
design system. Supported versions are documented with explicit rejection of unknown encodings.

ZIP/RAR packaging recursively inventories nested supported packages within cumulative entry,
byte, recursion and time limits. Reject traversal, links, encrypted entries and decompression
bombs. Generated assets use safe content-addressed paths. Inputs remain outside Git.

## Application

Brandbook must physically affect native PPTX colours/fonts and native visual styles, not just
prompt prose or UI previews. Preparation/fit/export/audit use the same effective source.
Immutable specs record brand digest/profile and policy, checkpoints cannot cross those values,
and chat build reuse distinguishes brand selections. Editor round trips preserve branded output.
Logo usage needs explicit applicability/placement; arbitrary asset logos are not pasted over
slides with guessed exclusion zones. Missing rules inherit from template and are reported.

## Acceptance tests (write before implementation)

1. DTCG/Style Dictionary tokens and nested aliases resolve exactly; cycle/missing target fail
   visibly without invented colours.
2. PDF literal RGB/HEX/font declarations have page evidence; merely observed paints/fonts do
   not override declared tokens. Image-only pages report OCR needs.
3. SVG/raster logos and font ZIP contents are inventoried with safe assets and source digests.
4. FSP RAR lists all files and nested font archive contents; repeats have stable semantic output.
5. Traversal/links/encryption/size/count/depth violations fail without writing outside output.
6. Actual native FIG schema/message fixture yields colours, typography and frame structure;
   corruption/unsupported versions do not become successful empty profiles.
7. Brandbook conflict overrides PPTX in effective profile and exported file; template policy
   and no-brandbook controls preserve original values.
8. Account isolation protects brandbook profile/assets and generation lookup.
9. Brand digest/policy enter immutable spec/reuse identity; resume retains original brand and
   successful variants, including when library metadata changes.
10. UI upload -> parsed profile -> selected brand -> request -> generated native file is wired;
    synthetic distributable examples document supported formats and limitations.

## Evidence boundaries

Run offline suites, contract codegen, type/lint/import boundaries and meaningful real-file
parser/export probes. Verify supplied FSP archive locally without committing it. No production
deploy or paid inference is implied. Record browser/runtime gaps separately from unit tests.
