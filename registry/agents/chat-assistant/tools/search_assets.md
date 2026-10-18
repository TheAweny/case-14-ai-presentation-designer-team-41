List image leads from the configured image search. query is 1 to 300 characters after trimming.
limit is 1 to 5 and defaults to 5. trust is exactly search-results-not-evidence: a title and a
snippet are not facts. license unknown is not permission to use the image. url is the source page.
imageUrl is not downloaded. A turn shares eight new web calls with search_web, fetch_source and
research_topic. Repeating a successful query and limit does not spend another call. A failed call
is not cached and still spends one.
