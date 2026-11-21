# Genesis additions: How-to: a recurring pass

These notes add to the mind-set procedure `procedures/howto-subscription.md` (installed at
`~/.mind-set/current/procedures/howto-subscription.md`). Follow that procedure; at each place below,
do what this file says. They hold what is true of the Genesis compiler and the code it
generates, and the Genesis Compiler API steps.

## 1. In "7. Renewal versus charging"

Instead of the mind-set step that starts "## 8. Validate Validate the blueprint after every module you touched: ...":

#### 8. Validate, then verify the running service - the ladder

Validate every module you touched (`mindset validate`, then the Genesis
Compiler API's validation), compile, and start the service. Then climb,
recording what you OBSERVED per rung; log a rung you could not climb as a
finding, not as success.

| Rung | Call | Expect |
|---|---|---|
| 0 | `GET /<svc>-api/v1/payments/mock-status` | the provider listed with `mock: true`, `transport: "present"`, `blocking: false`. `transport: "absent"` = the brand has no mock; stop and report |
| 1 | catalog present: the generated service's route list shows the subscribe route; the plan seed rows exist | the seed was applied (otherwise compile and start the service again) |
| 2 | `POST .../v1/payments/admin/plans/provision` as superAdmin | `totals.provisioned` >= number of seeded plans; a second call reports them `skipped` |
| 3 | member: subscribe with the plan code (injected `POST /v1/subscribe<x>/:orderId` or your authored API) | 200 with `statusLiteral` (`active` or `trialing`; `pending_provider` plus a checkout form on iyzico: complete it per `howto-payment-flow.md`) and a `sys_<X>Subscription` row |
| 4 | read the allowance (`getBalance` or your wrapper) | the first period's allowance is present after an eligible confirmation (section 5); a still-unpaid first payment grants nothing |
| 5 | member: spend through the wrapper API; spend past zero | decrements; the overspend is refused with the wrapper's own error, the balance unchanged |
| 6 | trigger the renewal path (call the cron's business API by its manual route, or replay a renewal event) | the allowance is refreshed once; a second trigger with the same period is a no-op (`alreadyProcessed`) |
| 7 | member: `DELETE /v1/<x>subscription/:subscriptionId` | `canceled` (or cancel-at-period-end); the cancel hook revoked the allowance with a `consume` |

Failure reading: `409 SUBSCRIPTION_PLAN_NOT_FOUND` = seed missing;
`409 SUBSCRIPTION_PLAN_NOT_PROVISIONED` = run rung 2; a hook that "did
nothing" = read the service log for `PaymentLifecycleHookFailed`; an
overspend that succeeded = the wrapper reads the wrong owner row.
