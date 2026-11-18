import { UnrecoverableError } from "bullmq";
import { z } from "zod";
import { ID_PATTERN } from "./ids";
import { looksLikePostcode } from "./postcode";
import type { CustomerRepository } from "./repository";

const trimmed = (max: number) => z.string().trim().min(1).max(max);
const customerId = z.string().regex(ID_PATTERN).startsWith("cus_");

const SearchSchema = z
  .object({
    query: trimmed(100).optional(),
    first_name: trimmed(100).optional(),
    last_name: trimmed(100).optional(),
    postcode: trimmed(8)
      .refine(looksLikePostcode, "Not a UK postcode or outward code")
      .optional(),
    date_of_birth: z.iso.date().optional(),
    email: z.email().optional(),
    /** Restrict to these customers, e.g. the owner of an account found by the billing daemon. */
    ids: z.array(customerId).min(1).max(100).optional(),
    page: z.number().int().min(1).max(10_000).default(1),
    per_page: z.number().int().min(1).max(100).default(20),
  })
  .strict()
  .refine(
    (c) => Object.entries(c).some(([key, value]) => !["page", "per_page"].includes(key) && value !== undefined),
    "Provide at least one search criterion",
  );

const GetSchema = z.object({ id: customerId }).strict();
const GetManySchema = z.object({ ids: z.array(customerId).min(1).max(100) }).strict();
const RefsSchema = z
  .object({
    after: z.string().optional(),
    limit: z.number().int().min(1).max(1_000).default(500),
  })
  .strict();

/** Invalid input will never succeed on retry, so fail it permanently. */
function parse<T>(schema: z.ZodType<T>, payload: unknown): T {
  const result = schema.safeParse(payload);

  if (!result.success) {
    throw new UnrecoverableError(`Invalid payload: ${z.prettifyError(result.error).replace(/\n/g, "; ")}`);
  }

  return result.data;
}

export type TaskHandler = (payload: unknown) => unknown;

/**
 * Tasks this daemon serves on the `customers` queue.
 *
 * Exposed through the gateway (allow-listed in ../queue/src/catalog.ts):
 * - customers.search    → Page<Customer>
 * - customers.get       → Customer | null
 * - customers.get_many  → Customer[] (in requested order; unknown ids skipped)
 *
 * Internal (daemon-to-daemon over Redis, not allow-listed in the gateway):
 * - customers.refs      → { id, status, created_at }[] keyset-paginated; no personal data
 */
export function createTasks(repo: CustomerRepository): Record<string, TaskHandler> {
  return {
    "customers.search": (payload) => repo.search(parse(SearchSchema, payload)),
    "customers.get": (payload) => repo.find(parse(GetSchema, payload).id),
    "customers.get_many": (payload) => repo.findMany(parse(GetManySchema, payload).ids),
    "customers.refs": (payload) => {
      const { after, limit } = parse(RefsSchema, payload);
      return repo.listRefs(after, limit);
    },
  };
}
