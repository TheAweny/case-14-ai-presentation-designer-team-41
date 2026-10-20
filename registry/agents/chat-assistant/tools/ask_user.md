Ask the person one question with two to six short options; they may also answer in their own
words. `multiSelect` lets them pick several. The turn ends here and goes on with the answer.

For preparation, first read the accessible materials and suitable layouts. Ask the single most
significant unresolved question and briefly explain what the answer changes. Use the optional
`preparationKey` to bind the answer to `audience`, `goal`, `desiredAction` or a `requirements.*` key.
The result returns the key and questionId; the server binds the reply and saves it as user, unknown
or declined. Do not invent identifiers or attach a reply to another question or project.
Do not ask again for a key already user/source/unknown/declined, including after reload or retry.
Ask only for an absent or assumption key; do not pre-save unknown for a question you intend to ask.
Corrections come through an ordinary message and `save_preparation`. Respect saved `questionPolicy`
`no-questions`; missing facts never become zero, names, contacts or promises.
