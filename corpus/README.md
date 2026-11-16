# genesis-set corpus (pre-release)

The documents the genesis-set skills read. `genesis-set install` copies this folder to
`~/.genesis-set/<version>/` and links it as `~/.genesis-set/current`; every skill names its
files by their absolute path in that copy.

genesis-set sits on mind-set and adds to it; nothing here repeats a mind-set document. The
OpenAPPL corpus (procedures, specification, schema, examples) is mind-set's, at
`~/.mind-set/current/`. A path written `procedures/<name>.md` in these files is a mind-set
procedure.

```
genesis/
  compiler-api.md        the Genesis Compiler API (pre-release: not reachable yet)
  procedures/            Genesis additions to the mind-set procedures, one file per
    README.md            procedure that has Genesis-specific steps, and their index
```

The Genesis Compiler API is not reachable yet; the generated-code knowledge in
`genesis/procedures/` already describes what the Genesis compiler produces today. Do not
edit the files here: a new `genesis-set update` replaces them.
