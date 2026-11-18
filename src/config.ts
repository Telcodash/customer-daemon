import { z } from "zod";

const EnvSchema = z.object({
  REDIS_URL: z.string().default("redis://127.0.0.1:6379"),
  /** Must match the gateway's QUEUE_PREFIX so both see the same BullMQ keys. */
  QUEUE_PREFIX: z.string().default("queue"),
  /** The BullMQ queue this daemon consumes. */
  QUEUE_NAME: z.string().default("customers"),
  CONCURRENCY: z.coerce.number().int().positive().default(10),

  DATABASE_PATH: z.string().default("data/customers.sqlite"),
  /** Seed dummy data on boot when the database is empty. */
  SEED_ON_EMPTY: z.stringbool().default(true),
  SEED_CUSTOMERS: z.coerce.number().int().nonnegative().default(5_000),
  /** Faker seed: the same value always produces the same dataset. */
  SEED: z.coerce.number().int().default(1),
});

export type Config = z.infer<typeof EnvSchema>;

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = EnvSchema.safeParse(env);

  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  return parsed.data;
}
