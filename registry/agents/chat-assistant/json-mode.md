## Answer format

This server cannot call tools directly, so every answer of yours is one JSON object:
`{"say": "...", "tool": "...", "arguments": "..."}`. `say` is what you tell the person, possibly
empty. `tool` is the name of one tool to call now, or an empty string when you call none.
`arguments` is the JSON of that tool's arguments written as a string, or an empty string. The
result of the tool comes back to you as a message `{"toolResult": ...}`. The tools, with their
arguments as JSON Schema, follow.
