# Fine Dine SaaS — product overview

**Status:** architecture baseline, not an implementation claim  
**Product decisions:** Windows-download demo; on-premise + hosted deployment; monthly/yearly subscriptions; 14-day trial; INR; Razorpay.

## Goal
Let a restaurant owner create an account, receive a self-service 14-day Windows POS trial, activate the POS against its hardware, and later subscribe and manage outlets/devices/payments online.

## System boundaries
- **SaaS control plane:** identity, organizations, outlets, plans, subscriptions, billing, payment records, licence issuance metadata, activation tokens, downloads, admin and audit.
- **On-premise outlet:** existing DinePOS server, SQLite operational database, desktop, Captain/KDS clients, printers. Must continue billing without internet.
- **Hosted outlet:** existing hosted-outlet runtime and one isolated operational database per outlet. Provisioning must use its documented lifecycle.
- **Cloud hub:** existing DinePOS cloud service for store pairing, sales sync, backups and licence renewal. Extend through a narrow server-to-server adapter; do not duplicate hub store/device logic.

## MVP journey
1. Owner registers and verifies email.
2. Owner creates organization and first outlet.
3. System creates one 14-day trial and queues idempotent provisioning.
4. Owner downloads Windows installer.
5. POS displays its existing hardware ID and activation code.
6. Owner completes activation; SaaS checks trial and issues a signed key compatible with the current verifier.
7. POS installs the key and runs locally/offline.
8. Owner purchases monthly or annual subscription; verified payment updates entitlement and licence renewal.

## Trial defaults
One organization, one outlet, one master PC, one additional terminal, two Captain devices, one KDS. Trial starts when provisioning succeeds. No payment method required. Trial expiry does not interrupt an open business day; existing local licence policy remains authoritative.

## Explicit non-goals for MVP
- Rewriting POS or its SQLite database.
- Moving orders, KOTs, bills or inventory into SaaS PostgreSQL.
- Replacing the cloud hub or its admin page.
- Lifetime licences.
- Automatically deleting customer data on trial expiry.
- Making SaaS availability a prerequisite for offline billing.

## Product acceptance
A new owner can register, receive a trial, install and activate Windows POS, disconnect the internet and continue permitted local operations, then subscribe and see an updated licence after reconnecting.

## Terminology
- **Organization:** commercial customer/account.
- **Outlet:** restaurant location and its POS installation.
- **Subscription:** commercial agreement for an organization.
- **Entitlement:** feature/quantity limits granted by a plan.
- **Licence:** signed offline-verifiable authorization installed by an outlet server.
- **Activation:** binding an outlet licence to a specific hardware identity.
- **Provisioning job:** retryable background workflow that prepares trial resources.
