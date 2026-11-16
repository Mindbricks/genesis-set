# Genesis additions: Blueprint authoring

These notes add to the mind-set procedure `procedures/blueprint-authoring.md` (installed at
`~/.mind-set/current/procedures/blueprint-authoring.md`). Follow that procedure; at each place below,
do what this file says. They hold what is true of the Genesis compiler and the code it
generates, and the Genesis Compiler API steps.

## 1. In "9. The authoring loop and the completeness gate"

Instead of the mind-set step that starts "Keep portable `js` by default and use optional native sources ...":

   Keep portable `js` by default, use optional native sources deliberately,
   and read a failed slot's provenance in the compile result's build log
   (the .NET translator gates are a Genesis compiler step). Supported direct awaited
   Internal API forms from #6546 work on the current generator; do not
   prescribe blanket C# rewrites or warning suppression.
