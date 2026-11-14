import type { Actor } from "@bsd/auth";
import type { Database } from "@bsd/database";

/** Everything a service needs; the actor always comes from the session (guide §6.1). */
export type AppContext = {
  db: Database;
  actor: Actor;
  requestId: string;
};

/** The client inside one interactive transaction. */
export type Tx = Parameters<Parameters<Database["$transaction"]>[0]>[0];
