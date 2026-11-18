# customer-daemon

The Customer Account Daemon (Bun + TypeScript + `bun:sqlite`). It owns customer data (people: name, date of birth, contact details, address) and serves it as BullMQ tasks on the `customers` queue. Billing accounts live in `../billing-daemon`. Core never calls it directly: requests go through the queue gateway (`../queue`).

```
Core ──POST /tasks?wait──▶ gateway ──▶ Redis queue "customers" ──▶ customer-daemon (Worker) ──▶ SQLite
```

It is the only system that stores customer personal data. Reads go through the gateway as **ephemeral** tasks: results are deleted from Redis as soon as they're returned, and Core doesn't store them.

## Running

```bash
cp .env.example .env
bun install
bun run dev                          # seeds 5,000 dummy customers on first boot
bun run seed --fresh --count=20000   # rebuild the dataset
bun test
bun run typecheck
```

`SEED` fixes the dataset: the same seed and day always generate the same customers.

## Data model

```
Customer (cus_…)                      ← this daemon
  └─ Billing Account (acc_…) 1..n     ← ../billing-daemon (references cus_ ids)
       └─ Subscription / line          ← future Subscription daemon
            ├─ MSISDN                  ← future MSISDN daemon
            └─ SIM (ICCID/IMSI)        ← future SIM daemon
```

- IDs are prefixed ULIDs. Other daemons store them as plain references; there are no cross-database foreign keys.
- Addresses follow UK Royal Mail line order: `line_1` (flat or building), `line_2`, `town` (the post town), `county` (optional), `postcode` (normalised, e.g. `M14 5RG`).
- Dummy data is built so it can't reach real people. It uses real post towns with matching postcode areas, phone numbers from Ofcom's drama range (`07700 900xxx`), and `example.*` email domains.
- Migration 2 drops the `billing_accounts` table this daemon used to hold. The billing daemon seeds its own accounts from `customers.refs`.

## Tasks

| Task | Payload | Result | In gateway catalog |
|---|---|---|---|
| `customers.search` | `query`, `first_name`, `last_name`, `postcode`, `date_of_birth`, `email`, `ids` (≤100), `page`, `per_page` (≤100). At least one criterion is required; criteria are combined with AND. | `{ data: Customer[], total, page, per_page }` | yes |
| `customers.get` | `{ id: "cus_…" }` | `Customer` or `null` | yes |
| `customers.get_many` | `{ ids }` (≤100) | `Customer[]` in the order requested | yes |
| `customers.refs` | `{ after?, limit }` | `{ id, status, created_at }[]` paged by ID, with no personal data | no: internal, called by the billing daemon over Redis |

`query` is interpreted by its shape:
- `cus_…`: an ID.
- Contains `@`: an email address.
- Looks like a postcode: a full postcode matches exactly. An outward code like `M1` matches that district only, not M10–M19.
- Anything else: each word must match the start of the first or last name, so `jo smi` finds John Smith.

Account numbers aren't searched here. Core resolves an account number through the billing daemon, then searches with `ids: [owner]`.

An invalid payload throws `UnrecoverableError`, so it fails immediately with no retries. A new public task name must also be added to the gateway's allow-list in `../queue/src/catalog.ts`.
