# Genesis additions: How-to: the payment flow

These notes add to the mind-set procedure `procedures/howto-payment-flow.md` (installed at
`~/.mind-set/current/procedures/howto-payment-flow.md`). Follow that procedure; at each place below,
do what this file says. They hold what is true of the Genesis compiler and the code it
generates, and the Genesis Compiler API steps.

## 1. In "9. Validate"

Add:

**Runtime prerequisites.** The service compiled and running; the AUTH
service compiled AFTER the payment provider was bound (its `sys_paymentCustomer` / `sys_paymentMethod` family
is generated only then: a `startorderpayment` call 500s through a missing
`/auth-api/paymentcustomers` until auth is compiled again); a published,
in-stock product; a verified BUYER session (`pitfalls.md` section 1); a
`superAdmin` session for the operator rung; a staff-role session for
ship/deliver. Base paths below are an example (`/order-api`, `<order>` =
`order`); read yours off the generated service's route list.

**Webhook secret step.** After the FIRST compile of a service with a
payment provider, and after every reset of its database, call once as
superAdmin:
`POST /<service>-api/v1/payments/admin/webhooks/provision`, body `{}`.
It registers the webhook endpoint and stores its signing secret encrypted
in the service's database (restarts keep it); without it every webhook is
refused 401 `SIGNATURE_UNVERIFIABLE` and plan invoices / credit notes never
issue. Done = each `providers[]` entry `provisioned` / `rotated` with
`persisted: true`, or `already-registered` with `liveInThisProcess: true`
(after a reset it rotates by itself: `autoRotated: true`). Skip while the
provider is mock (`mock-status` `mock: true`). Re-run it after every framework
upgrade too: on a matched endpoint it adds the events a newer framework maps
and the endpoint lacks (`eventsAdded`, fw #6369; id and secret unchanged,
nothing removed); `eventsNotAdded` names events the provider refused to add,
report them to the owner. A call that creates or rotates the endpoint
also deletes this service's own endpoints at an older URL (`staleRemoved`; a
plain `already-registered` match deletes nothing), except the endpoint
of the stored secret and anything in a dev slot (`CONFIG_ENV=dev`): those are
only listed in `staleNotRemoved` with the reason. An endpoint at the same URL
with another owner's `mb_*` tags is never touched and is listed in
`foreignEndpointIds`: report it to the owner; an entry `failed`
with `errorCode: "WEBHOOK_ENDPOINT_LIMIT"` means the provider account is full:
report its `endpointsByProject` list to the owner (endpoints are pruned at the
provider, never by you) and re-run once they are removed.

**Payment re-provision after a database reset.** A reset of the service's
database empties the subscription plan catalog
(`sys_<X>SubscriptionPlans`), and the boot seed deliberately never writes
`providerPlanId`, so after EVERY reset each subscription purchase answers
409 `SUBSCRIPTION_PLAN_NOT_PROVISIONED`. For each payment service, as
superAdmin and BEFORE any purchase: first
`POST /<service>-api/v1/payments/admin/plans/provision`, body `{}` (a
service with subscription plans), THEN the webhook step above
(`POST /<service>-api/v1/payments/admin/webhooks/provision`, body `{}`).
The plan sweep finds the provider prices the earlier provisioning created
and adopts them; it creates nothing new. Done = `totals.failed: 0` with
every plan counted as `adopted` (the usual answer after a reset) or
`provisioned`, then the webhook done-check above.

| Rung | Call | Expect |
|---|---|---|
| 0 | `GET /order-api/v1/payments/mock-status` | `{ providers: [{ providerName, brand, mock: true, reason, transport: "present", blocking: false, mode }], anyMock: true, blocking: [], health: "ok" }` on a deployment with blank credentials — the mock adapter is the payment path; never call the live provider from tests. `transport`, not `mock`, is the field that says the mock path ANSWERS (see the brand caveat below): `transport: "absent"` puts the provider in `blocking[]` and flips `health` to `"blocked"`. A row that carries `transportFamilies` (Adyen) is covered only for the families with `coverage: "present"`: a call of an `absent` family is refused `501 MOCK_UNHANDLED_PATH` although `transport` reads `"present"` |
| 1 | buyer: `POST /order-api/cart/items { productId, quantity }`, `GET /order-api/cart`, `POST /order-api/checkout` | 201 with the order (`status: placed`, `paymentStatus: unpaid`, `expiresAt`), items priced from the catalog; `GET /order-api/cart` empty afterwards; an unavailable line answers 422 and creates NO order |
| 2 | buyer: `PATCH /order-api/v1/startorderpayment/:orderId` body `{ paymentUserParams: { return_url: "<app url>" } }` (add `providerOptions: { mockScenario: "requires_action" }` to exercise the 3-D Secure branch) | 200 with the ticket (`paymentStatus`, `statusLiteral`); the buyer must OWN the order (`403 NOT_OWNER` otherwise). With the default mock scenario the mock settles synchronously and the capture hooks run before the answer (`lifecyclePending: true` when they exceed `PAYMENT_SYNC_SETTLE_TIMEOUT_MS`, default 10 s) |
| 3a | `POST /order-api/v1/ordermockauthenticate/:orderId` | Mock mode only (404 otherwise): stands in for the customer authenticating and confirms the intent — needed in the `requires_action` scenario |
| 3b | superAdmin: `POST /order-api/v1/payments/admin/simulate-capture/order/:orderId` | Operator-gated like every `/v1/payments/admin/*` route: `401 LOGIN_REQUIRED` without a session, `403 OPERATOR_REQUIRED` without the `paymentOperator` capability (a plain `staff` role is refused — pilot-verified; `superAdmin` passes). The route is platform-operator-only (`superAdmin` / `admin` / `saasAdmin`; `superAdmin` / `saasAdmin` in a multi-tenant project, which has no role named `admin`, #5701), and that second gate answers differently HERE: a tenant-level operator (`tenantOwner` / `tenantAdmin`), or a caller admitted only through the `paymentOperator` permission, PASSES the operator gate and is then refused `404` rather than the console's `403 PLATFORM_OPERATOR_REQUIRED`, so this sandbox route reads as unmounted - assert 404, not 403, for that actor. Also: 404 with no payment ticket yet ("start the payment first"), 404 on a production deployment or non-test credentials, `409 PAYMENT_NOT_CAPTURABLE` on a terminal ticket; repeat answers 200 `outcome: "already-recorded"` when its event-store lookup completes within the wait budget; if recording has not completed by that deadline, the 200 body instead carries `outcome: "record-pending"` and `lifecyclePending: true` (including on a repeat). Recording continues after the answer; the existing row is reused when found. `PAYMENT_SYNC_SETTLE_TIMEOUT_MS=0` skips waiting and answers `record-pending` immediately |
| 4 | `GET /order-api/v1/orderpaymentbyorderid/:orderId`; `GET /order-api/my-orders/:orderId` | ticket `statusLiteral` captured (or `paymentStatus: simulated_capture` after 3b); the ORDER shows `status: paid`, `paymentStatus: succeeded`, `paidAt`, `paymentReference` = the provider intent id — proof the `afterPaymentCaptured` hook ran your API. If the ticket is captured but the order did not move, read the service log for `PaymentLifecycleHookFailed` (hook name, trigger, error) — the hook ran and your API refused |
| 5 | a Kafka consumer on the wire topic (`<codename>-order-service-payment-captured`); the notification service's log or its notification rows in the database | the captured event with your payload keys; the `paymentReceived` mail resolved to `customerUserId` |
| 6 | staff: `POST /order-api/orders/:orderId/ship { trackingNumber }`, then `.../deliver` | `shipped` with `shippedAt` + tracking; an unpaid or claim-incomplete order answers 422 (static message); `paid` -> `shipped` -> `delivered` are one-way — do NOT retry on a state-shaped 422, pick another open order |
| 7 | buyer: `POST /order-api/my-orders/:orderId/cancel` on a PAID, unshipped order | 200 `status: cancelled`, `paymentStatus: refund_pending`, the `sys_orderRefund` row exists (`GET /order-api/v1/payments/refunds`), stock released once at the catalog; a shipped order answers 422 with no refund and no release. Then re-read the order: `paymentStatus: refunded` once `afterPaymentRefunded` converged it — if it stays `refund_pending`, the sweep retries every 5 min; record what you observed (the pilot could not climb this rung because the iyzico mock transport did not exist yet; it does now — climb it) |
| 8 | wait past `expiresAt` on an UNPAID order (or seed one with a past `expiresAt`) | the minute cron flips it to `expired`, publishes `order-expired`, releases nothing; a capture racing the sweep wins (`applyPaymentCapture` refunds a late capture in full and keeps `expired`) |

**Brand caveat — READ THE `transport` FIELD (fw #4473, SHIPPED).**
`mock: true` only says the credentials are blank; whether the mock path
WORKS is the per-provider `transport` field, and `stripe`, `iyzico` and
`adyen` all answer `transport: "present"` now. An iyzico-bound object climbs the whole
ladder on its mock — rungs 2-8 must NOT be logged as skips, and a lane that
records them as "blocked by #4473" is reporting a condition that no longer
exists. An Adyen-bound object's mock answers too. Adyen has no
`GET /payments/{pspReference}`, and since fw #5808 the adapter never calls it:
a capture, cancel or refund sends the amount and currency recorded on the
payment (or the refund) itself, and a refresh answers from the ticket and the
state the notifications already persisted, so the refund of rung 7 and a
refresh climb on the mock like every other brand - do NOT log them as a
reasoned skip. Note what stays true of Adyen: a webhook AUTHORISATION leaves
the payment `authorized` (only a CAPTURE pays), and a shopper-action challenge
you abandon is not auto-cancelled - a restart inside the action window
(`ADYEN_ACTION_TTL_MS`, 30 minutes) resumes the same attempt from the ticket,
and after it the restart answers 409 (there is no automatic unlock yet). An
iyzico restart of an open payment (fw #6343) answers the SAME step again
(`pendingIntentReused: true`, `next_action.paymentPageUrl` or
`next_action.threeDSHtmlContent`, with `next_action.actionExpiresAt`) while
it has not expired; a restart that names another card (or switches between
no card and a card) opens a new attempt while the open payment provably
cannot capture (an expired hosted page nobody started paying on, a 3-D
Secure payment at `INIT_THREEDS`) and answers `409 PAYMENT_START_INTENT_PENDING` otherwise - on
Stripe a changed `paymentMethodId` is always that 409. Assert these, do not
log them as defects. A brand with no mock of its own (paypal, mangopay, ...) still answers
`transport: "absent"`: the adapter constructs and then refuses every call by
name, `blocking` lists that provider and `health` is `"blocked"`. Only THAT
is a reasoned skip, and it is named by the payload rather than assumed.

## 2. In "9. Validate"

Add:

**Rung fails — where the fix goes.** A 500 on your own route is a design
fault: fix the blueprint, rebuild (`iteration.md`), never the generated
code. A pattern route misbehaving with your blueprint clean is a compiler
fault: capture `requestId` + the exact error from the service log
and report it with evidence. `column "x" does not exist` after a blueprint
change is schema drift — rebuild, never hand DDL (`pitfalls.md` section 3).
