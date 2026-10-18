Create a deterministic PNG QR card for one exact URL. Input: {url}, an absolute HTTP(S) URL of
at most 2048 UTF-8 bytes, without whitespace, controls, backslashes or credentials. Preserve its
original spelling and signed query. The URL must appear as a complete token in an actual user
message, as the requested/final URL of a successful fetch_source, or in text returned by a
successful read_file/extract_material for a file attached in this chat. Assistant claims, search
snippets and a model's tool arguments do not qualify. Eight unique URLs per turn; duplicates
reuse a card. Available in chat, plan and auto. No destination request is made. The UI receives
the PNG; the tool returns only its ID, URL, hash, dimensions, source and reachability metadata.
Do not claim availability unless reachability.status is fetched.
