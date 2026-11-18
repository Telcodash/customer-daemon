import { UnrecoverableError, Worker } from "bullmq";
import IORedis from "ioredis";
import { loadConfig } from "./config";
import { openDatabase } from "./db";
import { CustomerRepository } from "./repository";
import { isEmpty, seed } from "./seed";
import { createTasks } from "./tasks";

const config = loadConfig();
const db = openDatabase(config.DATABASE_PATH);

if (config.SEED_ON_EMPTY && isEmpty(db)) {
  const started = performance.now();
  const { customers } = seed(db, config.SEED_CUSTOMERS, config.SEED);
  console.log(`[customers] seeded ${customers} customers in ${Math.round(performance.now() - started)}ms`);
}

const tasks = createTasks(new CustomerRepository(db));

const worker = new Worker(
  config.QUEUE_NAME,
  async (job) => {
    const handler = tasks[job.name];

    if (!handler) throw new UnrecoverableError(`Customer daemon has no task [${job.name}]`);

    // Jobs from the gateway wrap the input as { payload, callbackUrl?, meta? }.
    return handler(job.data?.payload ?? {});
  },
  {
    connection: new IORedis(config.REDIS_URL, { maxRetriesPerRequest: null }),
    prefix: config.QUEUE_PREFIX,
    concurrency: config.CONCURRENCY,
  },
);

worker.on("failed", (job, error) => console.warn(`[customers] ${job?.name} ${job?.id} failed: ${error.message}`));
worker.on("error", (error) => console.error(`[customers] ${error.message}`));
worker.on("ready", () => console.log(`[customers] consuming [${config.QUEUE_NAME}] (concurrency ${config.CONCURRENCY})`));

let shuttingDown = false;

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[customers] ${signal} received, finishing active jobs...`);
  await worker.close();
  db.close();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
