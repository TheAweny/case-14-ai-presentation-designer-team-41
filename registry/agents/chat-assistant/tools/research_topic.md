Delegate one question to the web researcher using public search and fetched pages. question
is 1 to 1000 characters. This tool is available only when search and the researcher are configured.
Quotes carry unverified support; search snippets are not evidence. A turn allows 4 new research
questions. Repeating a successful question returns its cached result for free; failed research
still consumes one question. Each internal search spends the search quota of 8, and each page
read the separate read quota of 24. Image search has 4 reserved operations; all web operations
are bounded by 36 in total. On web_budget_exhausted, stop repeating the exhausted operation;
keep partial evidence and use remaining operations, or ask the person to continue in a later
message. The agent cannot start a new turn or reset these budgets by itself. A failed page adds
a whitelist error such as web_http_403, with status, kind, retryable and action when present,
never a body or a secret. Do not repeat that URL or the same question just to get around it.
404 and 410 close only that page; another URL on the same site can still be read. On 401 or
403, do not try nearby paths or aliases only to bypass the denial; a separate document is fine,
including on that site. 429 waits for a later message. For 5xx and timeout, do not loop: use
other pages, and retry later or once if temporary. Snippets are not facts. Evidence already
kept still stands.
