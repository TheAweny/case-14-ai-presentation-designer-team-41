Search the public web when WEB_SEARCH_URL is configured. query is 1 to 300 characters after trimming.
limit is 1 to 8 and defaults to 5. The result is the search answer itself: urls, titles, snippets,
publishedAt and trust. trust is exactly search-results-not-evidence: snippets are not facts. Use
publishedAt when a result has one. A shared turn budget of eight new web calls also covers
fetch_source. A failed call still spends one of those eight. Repeating a successful query and limit
does not spend another call; a failed call is not cached.
