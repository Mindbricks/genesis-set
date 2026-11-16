# Genesis additions: Project lifecycle

These notes add to the mind-set procedure `procedures/project-lifecycle.md` (installed at
`~/.mind-set/current/procedures/project-lifecycle.md`). Follow that procedure; at each place below,
do what this file says. They hold what is true of the Genesis compiler and the code it
generates, and the Genesis Compiler API steps.

## 1. In "1. Dependency graph — always respect, even on partial requests"

Add:

**Compile once, after authoring.** With the single exception of auth
(compiled first because domain authoring reads its live shape), do not
compile a service just because the Compiler API is at hand right after you
authored it. Every build is charged by the lines it adds, and compiling a
domain service before the bff wires `dataViewName` into its APIs costs a
second, avoidable round: author and validate everything first, THEN compile
it once.

## 2. In "2. The phases > Phase D — Design (the interview, the requirement docs, the specs)"

Add:

With genesis-set, that compiler is the Genesis compiler, reached through the
Genesis Compiler API (the genesis-compiler-api skill): compile `auth` first,
then every other service once, after the whole blueprint validates, and run
the result locally or deploy it yourself; the Compiler API only writes code.
