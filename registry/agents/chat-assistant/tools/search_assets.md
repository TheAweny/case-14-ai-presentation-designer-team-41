List image leads from the configured image search. query is 1 to 300 characters, limit is 1
to 5 (default 5). Titles and snippets are discovery leads, not facts. url is the source page and
imageUrl is not downloaded. An unknown license does not grant permission to use an image.
Show the person a selection before using images. A turn allows 4 new image searches, separately
from 8 text searches and 24 page reads, with 36 web operations overall. Successful repeated
query and limit are cached for free; a failed call consumes one image search. On
web_budget_exhausted, stop repeating the exhausted operation and use the remaining tools.
Only a later message from the person starts a new turn and resets budgets.
