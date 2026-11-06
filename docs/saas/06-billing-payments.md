# Subscription billing and Razorpay

## Commercial model
MVP supports monthly and annual subscriptions in INR. Plans and prices are read from server-side catalogue. Plan entitlements determine outlet count, device seats, feature access and hosted deployment eligibility. No lifetime licence in MVP.

## Checkout
1. Customer selects plan.
2. API loads active plan price and entitlement version.
3. API creates a local pending payment and Razorpay order with a unique receipt/idempotency reference.
4. Browser completes gateway checkout.
5. Browser callback is informational only; it cannot activate subscription.
6. Razorpay webhook raw body signature is verified.
7. Event ID is deduplicated; payment/order IDs and amount/currency are cross-checked.
8. On confirmed capture, transaction marks payment captured, activates/extends subscription and enqueues licence renewal + invoice.
9. Worker issues renewal through licensing adapter and emails invoice.

## State rules
Subscription: trialing, active, past_due, paused, cancelled, expired.
Payment: created, authorized, captured, failed, refunded, partially_refunded.
Cancellation at period end keeps access until paid-through date. Failed renewal enters past_due and follows a configurable retry/grace policy. Refund does not erase payment record; it creates refund transaction and adjusts entitlement according to refund policy.

## Financial data
Store amount in integer paise and ISO currency. Keep plan price snapshots, billing address, GSTIN, place of supply, tax rate/amount, invoice number and invoice PDF snapshot. Never recompute old invoices using current plan or tax settings. Invoice numbering must be transactionally unique. Accountant must validate Indian GST applicability, place-of-supply, invoice fields and tax treatment before launch.

## Webhook security
- Capture raw request bytes before JSON parsing.
- Verify provider signature with webhook secret from secret manager.
- Validate event type, gateway order ID, payment ID, amount and currency.
- Persist event ID before processing; duplicates return success without repeating effects.
- Handle out-of-order events using monotonic state transitions and gateway fetch/reconciliation where needed.
- Redact card/payment personal data from logs.
- Provide reconciliation job for pending payments.

## Acceptance tests
Valid captured event activates subscription once; duplicate event has no duplicate invoice/licence; invalid signature is rejected; amount mismatch does not activate; failed payment does not activate; cancellation at period end preserves paid-through access.
