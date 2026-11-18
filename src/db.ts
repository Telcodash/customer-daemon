import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Schema migrations, applied in order and tracked with SQLite's `user_version` pragma.
 * Append new entries; never edit an applied one.
 */
export const MIGRATIONS: string[] = [
  `
  CREATE TABLE customers (
    id TEXT PRIMARY KEY,
    title TEXT,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    date_of_birth TEXT NOT NULL,
    email TEXT NOT NULL,
    contact_phone TEXT NOT NULL,
    address_line_1 TEXT NOT NULL,
    address_line_2 TEXT,
    town TEXT NOT NULL,
    county TEXT,
    postcode TEXT NOT NULL,
    postcode_compact TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('active', 'closed')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX customers_last_name ON customers (last_name COLLATE NOCASE, first_name COLLATE NOCASE);
  CREATE INDEX customers_first_name ON customers (first_name COLLATE NOCASE);
  CREATE INDEX customers_postcode ON customers (postcode_compact);
  CREATE INDEX customers_email ON customers (email COLLATE NOCASE);
  CREATE INDEX customers_dob ON customers (date_of_birth);

  CREATE TABLE billing_accounts (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL REFERENCES customers (id),
    account_number TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL CHECK (status IN ('active', 'suspended', 'closed')),
    payment_method TEXT NOT NULL CHECK (payment_method IN ('direct_debit', 'card')),
    billing_day INTEGER NOT NULL CHECK (billing_day BETWEEN 1 AND 28),
    billing_address_line_1 TEXT,
    billing_address_line_2 TEXT,
    billing_town TEXT,
    billing_county TEXT,
    billing_postcode TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    closed_at TEXT
  );
  CREATE INDEX billing_accounts_customer ON billing_accounts (customer_id);
  `,
  // Billing accounts moved to ../billing-daemon, which owns them from now on.
  `DROP TABLE billing_accounts;`,
];

export function openDatabase(path: string): Database {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });

  const db = new Database(path, { strict: true, create: true });

  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA foreign_keys = ON");
  db.run("PRAGMA busy_timeout = 5000");

  migrate(db);

  return db;
}

function migrate(db: Database): void {
  const { user_version: current } = db.query<{ user_version: number }, []>("PRAGMA user_version").get()!;

  for (let version = current; version < MIGRATIONS.length; version++) {
    db.transaction(() => {
      db.run(MIGRATIONS[version]!);
      db.run(`PRAGMA user_version = ${version + 1}`);
    })();
  }
}
