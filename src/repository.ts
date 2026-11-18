import type { Database } from "bun:sqlite";
import { compactPostcode, looksLikePostcode, normalizePostcode } from "./postcode";
import type { Customer, CustomerStatus, Page } from "./types";

interface CustomerRow {
  id: string;
  title: string | null;
  first_name: string;
  last_name: string;
  date_of_birth: string;
  email: string;
  contact_phone: string;
  address_line_1: string;
  address_line_2: string | null;
  town: string;
  county: string | null;
  postcode: string;
  status: CustomerStatus;
  created_at: string;
  updated_at: string;
}

export interface SearchCriteria {
  /** Free text: a name, postcode, email, or cus_ id. (Account numbers belong to the billing daemon.) */
  query?: string;
  first_name?: string;
  last_name?: string;
  postcode?: string;
  date_of_birth?: string;
  email?: string;
  ids?: string[];
  page: number;
  per_page: number;
}

/** Minimal customer reference handed to other daemons (no personal data). */
export interface CustomerRef {
  id: string;
  status: CustomerStatus;
  created_at: string;
}

/** Escape LIKE wildcards; every LIKE below uses ESCAPE '\'. */
const likePrefix = (value: string) => `${value.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/**
 * "M1" must match district M1 only, not M10–M19: a bare outward code matches up to the space.
 * A full postcode matches exactly; a partial inward code ("SW1A 1") matches as a prefix.
 */
function postcodeCondition(input: string, bind: (value: string) => string): string {
  const compact = compactPostcode(input);
  const full = normalizePostcode(input);

  if (full) return `c.postcode_compact = ${bind(compactPostcode(full))}`;
  if (/^[A-Z]{1,2}[0-9][A-Z0-9]?$/.test(compact)) return `c.postcode LIKE ${bind(likePrefix(`${compact} `))} ESCAPE '\\'`;

  const [outward, inward] = input.trim().toUpperCase().split(/\s+/);

  // Without a space, "SW1A1" can't be split reliably, so fall back to a plain prefix.
  return inward
    ? `c.postcode LIKE ${bind(likePrefix(`${outward} ${inward}`))} ESCAPE '\\'`
    : `c.postcode_compact LIKE ${bind(likePrefix(compact))} ESCAPE '\\'`;
}

export class CustomerRepository {
  constructor(private readonly db: Database) {}

  search(criteria: SearchCriteria): Page<Customer> {
    const where: string[] = [];
    const params: Record<string, string | number> = {};
    let n = 0;
    const bind = (value: string | number) => {
      const key = `p${n++}`;
      params[key] = value;
      return `$${key}`;
    };

    if (criteria.query) {
      const q = criteria.query.trim();

      if (/^cus_/i.test(q)) {
        where.push(`c.id = ${bind(`cus_${q.slice(4).toUpperCase()}`)}`);
      } else if (q.includes("@")) {
        where.push(`c.email = ${bind(q)} COLLATE NOCASE`);
      } else if (looksLikePostcode(q)) {
        where.push(postcodeCondition(q, bind));
      } else {
        // Every word must prefix-match the first or last name: "jo smi" finds "John Smith".
        for (const token of q.split(/\s+/).filter(Boolean)) {
          const p = bind(likePrefix(token));
          where.push(`(c.first_name LIKE ${p} ESCAPE '\\' OR c.last_name LIKE ${p} ESCAPE '\\')`);
        }
      }
    }

    if (criteria.first_name) where.push(`c.first_name LIKE ${bind(likePrefix(criteria.first_name))} ESCAPE '\\'`);
    if (criteria.last_name) where.push(`c.last_name LIKE ${bind(likePrefix(criteria.last_name))} ESCAPE '\\'`);
    if (criteria.postcode) where.push(postcodeCondition(criteria.postcode, bind));
    if (criteria.date_of_birth) where.push(`c.date_of_birth = ${bind(criteria.date_of_birth)}`);
    if (criteria.email) where.push(`c.email = ${bind(criteria.email)} COLLATE NOCASE`);
    if (criteria.ids) where.push(`c.id IN (${criteria.ids.map((id) => bind(id)).join(", ")})`);

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const total = this.db.query<{ n: number }, typeof params>(`SELECT COUNT(*) AS n FROM customers c ${whereSql}`).get(params)!.n;

    const rows = this.db
      .query<CustomerRow, typeof params>(
        `SELECT c.* FROM customers c ${whereSql}
         ORDER BY c.last_name COLLATE NOCASE, c.first_name COLLATE NOCASE, c.id
         LIMIT ${bind(criteria.per_page)} OFFSET ${bind((criteria.page - 1) * criteria.per_page)}`,
      )
      .all(params);

    return { data: rows.map(toCustomer), total, page: criteria.page, per_page: criteria.per_page };
  }

  find(id: string): Customer | null {
    const row = this.db.query<CustomerRow, [string]>("SELECT * FROM customers WHERE id = ?").get(id);

    return row ? toCustomer(row) : null;
  }

  /** Several customers by id, in the order requested; unknown ids are skipped. */
  findMany(ids: string[]): Customer[] {
    if (ids.length === 0) return [];

    const rows = this.db
      .query<CustomerRow, string[]>(`SELECT * FROM customers WHERE id IN (${ids.map(() => "?").join(",")})`)
      .all(...ids);
    const byId = new Map(rows.map((row) => [row.id, row]));

    return ids.flatMap((id) => {
      const row = byId.get(id);
      return row ? [toCustomer(row)] : [];
    });
  }

  /** Keyset-paginated customer references, for other daemons (e.g. billing seeding its accounts). */
  listRefs(after: string | undefined, limit: number): CustomerRef[] {
    return this.db
      .query<CustomerRef, [string, number]>("SELECT id, status, created_at FROM customers WHERE id > ? ORDER BY id LIMIT ?")
      .all(after ?? "", limit);
  }
}

function toCustomer(row: CustomerRow): Customer {
  return {
    id: row.id,
    title: row.title,
    first_name: row.first_name,
    last_name: row.last_name,
    date_of_birth: row.date_of_birth,
    email: row.email,
    contact_phone: row.contact_phone,
    address: {
      line_1: row.address_line_1,
      line_2: row.address_line_2,
      town: row.town,
      county: row.county,
      postcode: row.postcode,
      country: "GB",
    },
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
