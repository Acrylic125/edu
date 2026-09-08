# Free and Pro credits

Edit `cost.ts` to change credit costs or plan allowances. The API is authoritative and sends current limits to `/usage`; the web app does not duplicate plan values. Deploy the API after changing configuration.

| Allowance | Free | Pro | Meaning |
| --- | ---: | ---: | --- |
| Credits/5 hours | 250 | 1,000 | Consecutive epoch-aligned five-hour windows |
| Credits/week | 1,200 | 15,000 | Monday 00:00 UTC through the following Monday |

Each accepted turn costs one credit, including tool calls, image processing, repairs, and background memory work within that turn. Each image upload costs one additional credit. Each PDF upload costs one additional credit per page when accepted for indexing. Confirming or rejecting an existing proposal is free because current proposal handlers only apply an already-generated plan. Reading history, editing a plan through HTTP, reconnecting, and stopping do not consume credits.

Invalid messages and credit rejections consume nothing. Failed runs without useful output are refunded. User cancellation after admission counts. A worker crash with an uncertain execution outcome conservatively retains the debit. Automatic provider retries are included in the turn and do not add credits. Reusing a message ID never reruns or charges the action again, even if its credits were refunded; a deliberate retry needs a new ID.

All windows use server time. A delayed refund goes to its original credit windows and usage-chart buckets. Upgrades and downgrades change limits immediately on the next admission without resetting counters or deleting existing content.

## Shared safety limits

Also configured in `plans.ts`:

- 120 authenticated HTTP requests per rolling minute, including WebSocket upgrades.
- 10 upload-URL requests per rolling minute, including rejected attempts.
- Five WebSocket connections. One running chat is an architectural invariant because the user shares one active topic/run across tabs.
- 256 KiB/image, 20 MiB/PDF, 500 pages/PDF, five attachments/message.
- One-hour upload reservation. Pending/invalid/abandoned uploads are deleted by a Durable Object alarm and their image/page credits are refunded. Cleanup runs after expiry; reservations remain unavailable until cleanup succeeds.
- 120-second run deadline, 12 model calls/run, 120,000 textual input characters/call, 4,096 output tokens/call and 16,384 aggregate output tokens/run. The same runner budget covers deferred work. Interrupted calls retain their reserved output budget.

AI safety limits bound work, not an exact dollar price. Provider prices and unavailable usage still need operational monitoring before setting a commercial Pro price. Existing `model_usage` records retain provider/unavailable cost provenance. Original-file storage excludes derived PDF text and database metadata.

PDF page credits are reserved before indexing. Completion stores a durable queue outbox entry atomically with the upload state. An alarm sends it to the queue; a delivery retry never charges pages again. Failed indexing retains the accepted credits, allowing retry without another debit. Completed files cannot be overwritten. PUT size must exactly match the reservation.

## Persistence and recovery

`user.plan` is `free | pro`, defaults to `free`, and is not accepted as client input by Better Auth. The API reads it from D1 for every plan-sensitive admission, including on already-open sockets.

Each user's existing `ChatDurableObject` owns transactional credit counters, chart buckets, and idempotency/reservation records. They survive hibernation and restarts. Read-only `/usage` returns the current allowances and authoritative credit history. Existing completed attachments remain readable. Old unfinished POC uploads should be re-uploaded.

D1 and Durable Object storage are separate: resetting D1 alone does not reset quotas for reused user IDs. Use new user IDs or reset the matching local Durable Object state when resetting the entire POC.

## Manual plans and migrations

From `backend/edu-api`:

```sh
pnpm db:migrate:local
pnpm plan:set <user-id> pro --local
pnpm plan:set <user-id> free --local
```

For a deliberate production migration/plan change:

```sh
pnpm db:migrate:remote:production-ben
pnpm plan:set <user-id> pro --remote
```

The command requires an explicit target, validates the plan, and prints the changed user ID/plan. Zero returned rows means the user was not found. Local plan commands use Wrangler's default local persistence directory.

## Stripe boundary (not connected yet)

`billing_account` prepares the unique user/customer/subscription mapping and subscription snapshot: price, status, period dates, cancellation flag, sync timestamp. No Stripe SDK, keys, Checkout, webhooks, or payment collection are installed.

When connecting Stripe, implement one `syncStripeCustomer(customerId)` function that fetches current subscription state and atomically updates the D1 snapshot and `user.plan`. Both a verified webhook and the authenticated checkout-return flow call that function. Persist the customer mapping before Checkout. Map server-configured price IDs to plans; do not accept a plan from Checkout metadata or the browser. Serialize synchronization per customer so older fetches cannot overwrite newer snapshots. Handle duplicate deliveries and durable retries; do not acknowledge work that has not been processed or durably queued.

Recommended future policy: active subscriptions get Pro; cancellation at period end preserves access until expiry; past-due subscriptions get a bounded three-day grace period; unpaid/canceled/expired subscriptions become Free. Trials remain disabled. Credit windows remain independent of invoice dates, including after upgrade. Stripe will become the writer of `user.plan`; do not keep manually overriding the same field once billing is live.

References: [t3dotgg's recommendations](https://github.com/t3dotgg/stripe-recommendations), [Stripe webhook delivery](https://docs.stripe.com/webhooks). Cloudflare's [native rate-limit binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/) is location-specific and eventually consistent; plan credits use transactional Durable Object storage instead.
