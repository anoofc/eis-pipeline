import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import EmbeddedPostgres from "embedded-postgres";

const root = fileURLToPath(new URL("../", import.meta.url));
const data = join(root, ".eis-data", "local-demo");
const cluster = join(data, "postgres");
const passwordFile = join(data, "database-password");
const host = "127.0.0.1";
const user = "eis_local";
const database = "eis_demo";

let child;
let stopping = false;
function requestStop() {
  stopping = true;
  child?.kill("SIGTERM");
}
process.on("SIGINT", requestStop);
process.on("SIGTERM", requestStop);

function run(args, env) {
  return new Promise((resolve, reject) => {
    child = spawn(process.execPath, args, { cwd: root, env, stdio: "inherit" });
    child.once("error", reject);
    child.once("close", code => {
      child = undefined;
      if (stopping || code === 0) resolve();
      else reject(new Error(`${args[0]} exited with code ${code ?? "unknown"}.`));
    });
  });
}

async function passwordForCluster() {
  if (!existsSync(join(cluster, "PG_VERSION"))) {
    await writeFile(passwordFile, randomBytes(24).toString("hex"), { mode: 0o600, flag: "wx" })
      .catch(error => { if (error.code !== "EEXIST") throw error; });
  }
  return (await readFile(passwordFile, "utf8")).trim();
}

function availablePort(port) {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen({host,port,exclusive:true}, () => {
      const {port: assigned} = probe.address();
      probe.close(error => error ? reject(error) : resolve(assigned));
    });
  });
}

async function selectPort() {
  const requested = process.env.EIS_DEMO_DB_PORT;
  if (requested !== undefined) {
    const port = Number(requested);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) {
      throw new Error("EIS_DEMO_DB_PORT must be a number between 1024 and 65535.");
    }
    return availablePort(port).catch(error => {
      if (error.code !== "EADDRINUSE") throw error;
      throw new Error(`Local PostgreSQL port ${port} is already in use. Unset EIS_DEMO_DB_PORT to select a free port automatically.`);
    });
  }
  return availablePort(0);
}

async function main() {
  const port = await selectPort();
  await mkdir(data, { recursive: true, mode: 0o700 });
  const password = await passwordForCluster();
  const startupLog = [];
  const db = new EmbeddedPostgres({
    databaseDir: cluster, port, user, password, authMethod: "scram-sha-256", persistent: true,
    autoRehydrateSymlinks: true,
    postgresFlags: ["-c", `listen_addresses=${host}`, "-c", "unix_socket_directories="],
    onLog: message => {
      startupLog.push(...String(message).trim().split("\n").filter(Boolean));
      if (startupLog.length > 20) startupLog.splice(0,startupLog.length-20);
    },
  });
  let started = false;
  try {
    if (!existsSync(join(cluster, "PG_VERSION"))) {
      console.log("Preparing the local EIS demo database…");
      await db.initialise();
    }
    if (stopping) return;
    startupLog.length = 0;
    try {
      await db.start();
      started = true;
    } catch (error) {
      const details = [...new Set([error?.message,...startupLog])].filter(Boolean);
      throw new Error([`Could not start local PostgreSQL on ${host}:${port}.`,...details].join("\n"));
    }
    const client = db.getPgClient("postgres", host);
    try {
      await client.connect();
      const { rowCount } = await client.query("SELECT 1 FROM pg_database WHERE datname=$1", [database]);
      if (!rowCount) await client.query("CREATE DATABASE eis_demo");
    } finally {
      await client.end();
    }
    const env = {
      ...process.env,
      NODE_ENV: "development", EIS_LOCAL_DEMO: "1",
      EIS_PUBLIC_ORIGIN: "", EIS_LOCAL_FILES: join(data, "files"),
      DATABASE_URL: `postgresql://${user}:${password}@${host}:${port}/${database}`,
    };
    for (const action of ["migrate", "demo"]) {
      if (stopping) return;
      await run(["scripts/database.mjs", action], env);
    }
    if (!stopping) {
      await run(["node_modules/next/dist/bin/next", "dev", "-H", host, ...process.argv.slice(2)], env);
    }
  } finally {
    if (started) await db.stop();
  }
}

try {
  await main();
} catch (error) {
  if (!stopping) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
