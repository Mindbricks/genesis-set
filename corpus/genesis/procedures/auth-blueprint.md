# Genesis additions: Auth module authoring

These notes add to the mind-set procedure `procedures/auth-blueprint.md` (installed at
`~/.mind-set/current/procedures/auth-blueprint.md`). Follow that procedure; at each place below,
do what this file says. They hold what is true of the Genesis compiler and the code it
generates, and the Genesis Compiler API steps.

## 1. In "5. Validate, build, gate"

Instead of the mind-set step that starts "2. Phase 3 must not start before the `authentication` module validates ...":

2. Compile the system service **`auth`** with the Genesis Compiler API (the
   genesis-compiler-api skill) and check its health where you run it — Phase 3
   must not start before the `auth` service is compiled and healthy.
