# Redistributable rendering fonts

Play Regular and Bold are from the Google Fonts `ofl/play` distribution.
License: SIL Open Font License 1.1, included as `Play/OFL.txt`.

Inter 4.1 static TTF faces are from the upstream `rsms/inter` release archive:
`https://github.com/rsms/inter/releases/download/v4.1/Inter-4.1.zip`.
License: SIL Open Font License 1.1, included unchanged as `Inter/OFL.txt`.
The nine weights and their italic faces retain original family names, including
`Inter SemiBold`; they are not renamed substitutes for other template fonts.
`Inter/SHA256SUMS` pins the bundled files for reproducible checks.

The Docker engine installs bundled fonts through fontconfig and verifies Inter,
Inter SemiBold and Play during the image build. Its entrypoint refreshes fontconfig
after mounting additional template fonts and before starting the HTTP server.

For other fonts, set `TEMPLATE_FONTS_DIR` in the ignored `.env` to a host directory
you can use under the fonts' licences. Compose mounts it read-only. The default is
`./data/fonts`, which is ignored by Git and excluded from Docker build context.
On macOS, original Arial faces may exist under `/System/Library/Fonts/Supplemental`.
Docker Desktop may deny a mount from `/System`; in that case place the required font
files in the ignored `data/fonts` directory instead of changing global Docker sharing.
The current local setup stages Arial Regular/Bold/Italic/Bold Italic there. These private
files are excluded from Git and Docker build context, not distributed with the image.
Restart the engine after changing mounted fonts so its index and cached metrics refresh.

For a local non-Docker macOS engine, install bundled TTFs in `~/Library/Fonts`.
Missing original families still block faithful export instead of silently substituting
a different font. Family names remain unchanged in exported PPTX.
