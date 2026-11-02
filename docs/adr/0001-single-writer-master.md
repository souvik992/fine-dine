# ADR-0001: One master PC is the only SQLite writer

- Status: accepted
- Date: 2026-11-02

## Context
Several terminals, captain phones and kitchen screens must see and change the same orders live, offline
from the internet, on cheap Windows hardware. SQLite in WAL mode needs all processes on one host and allows
one writer at a time; SQLite files on network shares can corrupt.

## Decision
Run one outlet server process on the master PC. It alone opens the DB. All other devices are API clients
(HTTP commands + WebSocket events). Writes are commands executed in one transaction each.

## Consequences
- Simple, consistent money handling; no multi-master merge logic.
- Master is a single point of failure → UPS, auto-restart service, 15-min backups, manual promote.
- Clients need a small offline outbox for order-taking during Wi-Fi drops.
