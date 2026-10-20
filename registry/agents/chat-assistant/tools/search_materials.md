Find a literal phrase in one text material attached in this chat. fileId is that attachment.
query is 1 to 200 characters after trimming and is matched as text, not as a pattern. offset
defaults to 0 and limit defaults to 5 (1 to 10). The result is the matches themselves: absolute
UTF-16 start and end, the original quote, and a short context. A false complete, a nextOffset,
or limitReached means this page is not the whole file.

PDF, DOCX and XLSX are read through extract_material or read_table. Search only the prepared
pages actually returned by those tools; do not claim a whole-document search from one page.
