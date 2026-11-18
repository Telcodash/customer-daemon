import { beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { UnrecoverableError } from "bullmq";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MIGRATIONS, openDatabase } from "../src/db";
import { ID_PATTERN } from "../src/ids";
import { normalizePostcode } from "../src/postcode";
import { CustomerRepository, type CustomerRef } from "../src/repository";
import { seed } from "../src/seed";
import { createTasks } from "../src/tasks";
import type { Customer, Page } from "../src/types";

const DAY = new Date("2026-01-01T00:00:00Z");

let db: Database;
let repo: CustomerRepository;
let tasks: ReturnType<typeof createTasks>;
let sample: Customer;

const search = (payload: Record<string, unknown>) => tasks["customers.search"]!(payload) as Page<Customer>;

beforeAll(() => {
  db = openDatabase(":memory:");
  seed(db, 1_000, 42, DAY);
  repo = new CustomerRepository(db);
  tasks = createTasks(repo);
  sample = repo.search({ query: "a", page: 1, per_page: 1 }).data[0]!;
});

describe("postcodes", () => {
  test("normalise valid UK postcodes and reject invalid ones", () => {
    expect(normalizePostcode("m145rg")).toBe("M14 5RG");
    expect(normalizePostcode(" sw1a  1aa ")).toBe("SW1A 1AA");
    expect(normalizePostcode("EC1V 9HX")).toBe("EC1V 9HX");
    expect(normalizePostcode("M14 5CG")).toBeNull(); // C is not a valid unit letter
    expect(normalizePostcode("12345")).toBeNull();
  });
});

describe("schema", () => {
  test("billing accounts were migrated out of this daemon", () => {
    const tables = db.query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((t) => t.name);

    expect(tables).toContain("customers");
    expect(tables).not.toContain("billing_accounts");
  });
});

describe("seed data", () => {
  test("is deterministic for a given seed", () => {
    const other = openDatabase(":memory:");
    seed(other, 1_000, 42, DAY);
    const ids = (d: Database) => d.query<{ id: string }, []>("SELECT id FROM customers ORDER BY id LIMIT 5").all();

    expect(ids(other)).toEqual(ids(db));
  });

  test("produces well-formed customers", () => {
    const all = db.query<{ id: string; postcode: string; contact_phone: string; email: string }, []>("SELECT * FROM customers").all();

    for (const c of all) {
      expect(c.id).toMatch(ID_PATTERN);
      expect(normalizePostcode(c.postcode)).toBe(c.postcode);
      expect(c.contact_phone).toMatch(/^07700 900\d{3}$/); // Ofcom drama range
      expect(c.email).toMatch(/@example\.(com|co\.uk|org)$/);
    }
  });
});

describe("customers.search", () => {
  test("free text name tokens prefix-match first and last names", () => {
    const result = search({ query: `${sample.first_name.slice(0, 3)} ${sample.last_name.slice(0, 3)}` });

    expect(result.data.map((c) => c.id)).toContain(sample.id);
  });

  test("finds by customer id (any case), email and full postcode", () => {
    for (const query of [sample.id, sample.id.toLowerCase(), sample.email.toUpperCase(), sample.address.postcode.toLowerCase().replace(" ", "")]) {
      expect(search({ query }).data.map((c) => c.id)).toContain(sample.id);
    }
  });

  test("an outward code matches its district only", () => {
    const outward = sample.address.postcode.split(" ")[0]!;
    const result = search({ postcode: outward, per_page: 100 });

    expect(result.total).toBeGreaterThan(0);
    expect(result.data.every((c) => c.address.postcode.startsWith(`${outward} `))).toBe(true);
  });

  test("combines structured criteria with AND", () => {
    expect(search({ last_name: sample.last_name, date_of_birth: sample.date_of_birth }).data.map((c) => c.id)).toContain(sample.id);
    expect(search({ last_name: sample.last_name, date_of_birth: "1900-01-01" }).total).toBe(0);
  });

  test("ids restrict results and combine with other criteria", () => {
    expect(search({ ids: [sample.id] }).data.map((c) => c.id)).toEqual([sample.id]);
    expect(search({ ids: [sample.id], last_name: sample.last_name }).total).toBe(1);
    expect(search({ ids: [sample.id], last_name: "Zzzzzz" }).total).toBe(0);
  });

  test("paginates", () => {
    const first = search({ query: "a", per_page: 5 });
    const second = search({ query: "a", per_page: 5, page: 2 });

    expect(first.data).toHaveLength(5);
    expect(first.total).toBe(second.total);
    expect(first.data[0]!.id).not.toBe(second.data[0]!.id);
  });

  test("treats LIKE wildcards literally", () => {
    expect(search({ query: "%" }).total).toBe(0);
    expect(search({ query: "_" }).total).toBe(0);
  });

  test("rejects empty, invalid or billing criteria permanently", () => {
    expect(() => search({})).toThrow(UnrecoverableError);
    expect(() => search({ postcode: "not a postcode" })).toThrow(UnrecoverableError);
    expect(() => search({ query: "x", per_page: 1000 })).toThrow(UnrecoverableError);
    expect(() => search({ account_number: "1234567890" })).toThrow(UnrecoverableError);
  });
});

describe("customers.get / get_many", () => {
  test("returns a customer, or null", () => {
    expect((tasks["customers.get"]!({ id: sample.id }) as Customer).id).toBe(sample.id);
    expect(tasks["customers.get"]!({ id: "cus_01ARZ3NDEKTSV4RRFFQ69G5FAV" })).toBeNull();
    expect(() => tasks["customers.get"]!({ id: "acc_01ARZ3NDEKTSV4RRFFQ69G5FAV" })).toThrow(UnrecoverableError);
  });

  test("get_many keeps request order and skips unknown ids", () => {
    const [a, b] = search({ query: "a", per_page: 2 }).data;
    const result = tasks["customers.get_many"]!({ ids: [b!.id, "cus_01ARZ3NDEKTSV4RRFFQ69G5FAV", a!.id] }) as Customer[];

    expect(result.map((c) => c.id)).toEqual([b!.id, a!.id]);
  });
});

describe("customers.refs (internal)", () => {
  test("pages through every customer by id without personal data", () => {
    const seen: string[] = [];
    let after: string | undefined;

    for (;;) {
      const page = tasks["customers.refs"]!({ after, limit: 300 }) as CustomerRef[];
      if (page.length === 0) break;
      expect(Object.keys(page[0]!).sort()).toEqual(["created_at", "id", "status"]);
      seen.push(...page.map((r) => r.id));
      after = page.at(-1)!.id;
    }

    expect(seen).toHaveLength(1_000);
    expect(new Set(seen).size).toBe(1_000);
  });
});

describe("migrations", () => {
  test("upgrading a v1 database drops billing_accounts and keeps customers", () => {
    const dir = mkdtempSync(join(tmpdir(), "customers-migrate-"));
    const path = join(dir, "v1.sqlite");

    try {
      const v1 = new Database(path, { create: true });
      v1.run(MIGRATIONS[0]!);
      v1.run("PRAGMA user_version = 1");
      v1.run(`INSERT INTO customers VALUES ('cus_01ARZ3NDEKTSV4RRFFQ69G5FAV', NULL, 'Ada', 'Lovelace', '1978-05-03',
        'ada@example.com', '07700 900001', '1 High Street', NULL, 'Leeds', NULL, 'LS1 1AA', 'LS11AA', 'active', 'x', 'x')`);
      v1.run(`INSERT INTO billing_accounts (id, customer_id, account_number, status, payment_method, billing_day, created_at, updated_at)
        VALUES ('acc_01ARZ3NDEKTSV4RRFFQ69G5FAV', 'cus_01ARZ3NDEKTSV4RRFFQ69G5FAV', '1234567890', 'active', 'card', 1, 'x', 'x')`);
      v1.close();

      const upgraded = openDatabase(path);
      const tables = upgraded.query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((t) => t.name);
      const version = upgraded.query<{ user_version: number }, []>("PRAGMA user_version").get()!.user_version;
      const customer = new CustomerRepository(upgraded).find("cus_01ARZ3NDEKTSV4RRFFQ69G5FAV");
      upgraded.close();

      expect(tables).not.toContain("billing_accounts");
      expect(version).toBe(MIGRATIONS.length);
      expect(customer?.first_name).toBe("Ada");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
