Read the text of a material the person attached (text, Markdown, CSV). `fileId` comes from the
attachments of a message. Read in pages: `offset` defaults to 0; `limit` is 1 to 8000 characters
and defaults to 8000. The result contains `text`, `offset`, `nextOffset`, and `totalChars`.
Continue with `nextOffset` until it is null before summarizing the whole material or asserting
that a fact is absent. A partial page does not establish the contents of the unread remainder.
