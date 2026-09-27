# recordings

Answers of real models, recorded with `MODEL_PROVIDER=record` and replayed with
`MODEL_PROVIDER=fake`. One directory per agent, one file per request, named by a hash of the
agent version, its prompt, the input and the seed: a changed prompt or input is a new recording,
never a stale answer.

This is what lets the pipeline tests and the offline demo run without a GPU or a network.
