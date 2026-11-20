import "server-only";
import { Pool, types, type PoolClient } from "pg";
import { type Staff, type Scope } from "./model";

types.setTypeParser(1082, value => value);
const globalDb = globalThis as typeof globalThis & { eisPool?: Pool };
export function db() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
  return globalDb.eisPool ??= new Pool({ connectionString: process.env.DATABASE_URL, max: 8, connectionTimeoutMillis: 5000 });
}

export async function transaction<T>(operation: (client: PoolClient, onRollback: (cleanup: () => Promise<void>) => void) => Promise<T>) {
  const client = await db().connect();
  const cleanups: Array<() => Promise<void>> = [];
  try {
    await client.query("BEGIN");
    const result = await operation(client, cleanup => cleanups.push(cleanup));
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    // A lost connection during COMMIT has an uncertain result. Preserve objects in that case.
    if (error instanceof Error && !/connection|terminat|socket/i.test(error.message)) {
      await Promise.allSettled(cleanups.map(cleanup => cleanup()));
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function audit(client: PoolClient, actor: Staff, entry: {
  opportunity?: string; entity: string; id: string; action: string; scope: Scope; detail?: object;
}) {
  await client.query(
    "INSERT INTO audit_log(actor_id,actor_name,opportunity_id,entity_type,entity_id,action,visibility,detail) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
    [actor.id, actor.name, entry.opportunity ?? null, entry.entity, entry.id, entry.action, entry.scope, entry.detail ?? {}],
  );
}
