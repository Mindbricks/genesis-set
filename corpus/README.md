# genesis-set corpus

The documents the genesis-set skills read. `genesis install` copies this folder to
`~/.genesis-set/<version>/` and links it as `~/.genesis-set/current`; every skill names its
files by their absolute path in that copy.

genesis-set sits on mind-set and adds to it; nothing here repeats a mind-set document. The
OpenAPPL corpus (procedures, specification, schema, examples) is mind-set's, at
`~/.mind-set/current/`. A path written `procedures/<name>.md` in these files is a mind-set
procedure.

```
genesis/
  compiler-api.md        the Genesis Compiler API and its genesis_* tools
  compile-results.md     reading a service build: statuses, job fields, failure codes
  custom-code.md         extending the generated code: LIB, API, dbLayer, edge controllers
  run-locally.md         running and debugging the generated services on your machine
  testing.md             the API test suite, the test transport, the sample-data seed
  deploy.md              deploying with your own login: docker-compose, Railway, Fly.io, Render (Genesis never deploys)
  pitfalls.md            compiler facts that look like bugs
  procedures/            Genesis additions to the mind-set procedures, one file per
    README.md            procedure that has Genesis-specific steps, and their index
```

Do not edit the files here: a new `genesis update` replaces them.
