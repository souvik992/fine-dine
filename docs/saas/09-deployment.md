# SaaS deployment and operations

## Environments
- local: Docker PostgreSQL, mock email, Razorpay test mode, test signing key only.
- staging: isolated database, test gateway, staging hub/store namespace, non-production signing key.
- production: managed PostgreSQL, secret manager, production signing key, Razorpay live credentials, HTTPS.

Never reuse production signing keys or customer data in local/staging environments.

## Services
- SaaS API: stateless Fastify service.
- SaaS worker: separate process; durable jobs and retries.
- PostgreSQL: backups, PITR if available, connection pooling and migrations.
- Web frontend: static hosting/CDN; API origin allowlisted.
- Object storage: installer artifacts and invoice PDFs; signed, expiring download URLs.
- Existing cloud hub: separate deployment and database; do not merge deployment or persistence.

## Configuration
Document and validate: DATABASE_URL, SESSION_SECRET, EMAIL_PROVIDER credentials, RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET, LICENCE_SIGNING_KEY reference, HUB_BASE_URL, HUB_SERVICE_CREDENTIAL, PUBLIC_APP_URL, installer bucket and log level. Never print secret values.

## Observability
Structured logs with correlation ID, job ID and organization/outlet IDs (avoid PII). Metrics: signup conversion, trial provisioning latency/failures, activation failures, active trials, payment capture/failure, webhook lag, licence renewal lag, worker retries, hub availability.

## Backup and recovery
Automated encrypted PostgreSQL backups and restore drills. Define RPO/RTO before production. Object storage versioning for installers/invoices. Hub backups remain under its own documented backup process. Test recovery without creating duplicate hub stores or reissuing shorter licences.

## Rollout
1. Local developer environment.
2. Staging signup and demo with test hub.
3. Staging Windows activation and offline billing.
4. Razorpay test checkout and webhook replay.
5. Security and tenant-isolation tests.
6. Production canary with internal outlet.
7. Gradual public trial signup.
