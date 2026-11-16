# Genesis additions: BFF module authoring

These notes add to the mind-set procedure `procedures/bff-blueprint.md` (installed at
`~/.mind-set/current/procedures/bff-blueprint.md`). Follow that procedure; at each place below,
do what this file says. They hold what is true of the Genesis compiler and the code it
generates, and the Genesis Compiler API steps.

## 1. In "5. Validate, build, gate"

Instead of the mind-set step that starts "2. The notifications module authoring starts only after":

2. Compile the system service **`bff`** with the Genesis Compiler API (the
   genesis-compiler-api skill) and check its health; the notifications module
   authoring starts only after
   the DataViews exist (its `dataViewName` references are checked against
   them).
