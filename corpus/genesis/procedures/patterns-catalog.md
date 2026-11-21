# Genesis additions: Patterns catalog

These notes add to the mind-set procedure `procedures/patterns-catalog.md` (installed at
`~/.mind-set/current/procedures/patterns-catalog.md`). Follow that procedure; at each place below,
do what this file says. They hold what is true of the Genesis compiler and the code it
generates, and the Genesis Compiler API steps.

## 1. In "0. Need -> pattern selector"

Instead of the mind-set step that starts "| Each user or tenant brings their OWN AI key (BYOK) | ...":

| Each user or tenant brings their OWN AI key (BYOK) | `AiProvider.credentialScopes` | nodejs, python, rust (user, tenant, workspace levels); dotnet, java, golang (user and tenant levels); never a key column or custom variable; `pitfalls.md` section 7 |
