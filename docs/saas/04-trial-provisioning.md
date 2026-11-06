# 14-day Windows demo provisioning

## Product rules
- Windows installer demo only for MVP.
- One trial per organization; no payment method required.
- 14 calendar days from successful provisioning completion.
- One outlet, one master PC, one additional terminal, two Captain devices, one KDS.
- Trial includes sample menu/categories/tables only if the installer/onboarding flow can seed safely; do not seed into an existing live outlet.
- Trial expiry does not interrupt an open business day. Existing POS licence state/grace remains authoritative.

## Workflow
1. Register account and verify email.
2. Create organization and first outlet.
3. In one PostgreSQL transaction, create trial subscription (provisioning state), job and idempotency record.
4. Worker claims job with lease/heartbeat.
5. Worker ensures hub store mapping only if required by the verified hub integration. Use a stable external idempotency key.
6. Worker creates one-time activation challenge and marks provisioning ready.
7. Email installer link and instructions.
8. Windows POS shows its existing hardware ID; owner enters short activation code in portal.
9. SaaS verifies challenge, trial, outlet ownership, hardware binding and seat entitlement.
10. Issuer signs existing v1 licence; metadata is saved; trusted hub adapter updates store licence.
11. POS fetches licence through its existing renewal flow.

## Job design
States: queued, running, retry_wait, succeeded, failed, cancelled. Store attempt count, next_attempt_at, lease_until, worker_id, sanitized last_error, idempotency_key and timestamps. A worker must recover expired leases. Retry transient errors with bounded exponential backoff + jitter; permanent validation errors fail without retry. Admin retry creates an audited retry event, not a duplicate job.

## Idempotency and abuse controls
- Unique trial per organization (enforced by transaction/constraint).
- Normalize email and phone.
- Rate limit by IP, email and phone; CAPTCHA/abuse check may be added.
- Do not rely only on hardware ID to prevent trial abuse.
- Activation codes: cryptographically random, high entropy, one use, short expiry; persist hash only.
- A hardware ID may be bound to one outlet at a time; hardware replacement is an owner/admin workflow with audit.

## Failure handling
Provisioning must be resumable after worker crash. Each external action records a stable request key and result. Do not delete a hub store or outlet on retry. Show customer a useful state and support reference; do not expose raw provider errors.

## Expiry and data lifecycle
Notify at 7, 3 and 1 days remaining and at expiry. Provide export/read-only policy and a documented retention period before deletion. Do not silently delete restaurant data. A paid subscription replaces trial entitlement only after verified payment.

## Acceptance tests
- Duplicate trial request creates one subscription and one job.
- Worker crash after hub operation does not create a second store on retry.
- Expired/used activation code is rejected.
- Activation for another organization's outlet is rejected.
- Trial clock starts on successful provisioning, not registration.
- No internet does not prevent POS local operations under its cached licence.
