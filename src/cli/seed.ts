/**
 * Re-seed the database: `bun run seed [--fresh] [--count=5000] [--seed=1]`.
 * Without --fresh, customers are appended to the existing data.
 */
import { parseArgs } from "node:util";
import { loadConfig } from "../config";
import { openDatabase } from "../db";
import { seed } from "../seed";

const config = loadConfig();
const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    fresh: { type: "boolean", default: false },
    count: { type: "string" },
    seed: { type: "string" },
  },
});

const db = openDatabase(config.DATABASE_PATH);

if (values.fresh) {
  db.transaction(() => {
    db.run("DELETE FROM customers");
  })();
}

const started = performance.now();
const result = seed(db, Number(values.count ?? config.SEED_CUSTOMERS), Number(values.seed ?? config.SEED));

console.log(`Seeded ${result.customers} customers in ${Math.round(performance.now() - started)}ms`);
db.close();
