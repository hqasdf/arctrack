import "server-only";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getAuthConfig } from "@/lib/auth/config";
import type { GarminConnection, GarminOperation, GarminTransaction } from "./types";

export type GarminPatch = Partial<Omit<GarminConnection, "user_id" | "version" | "operation" | "lease_until" | "deletion_requested_at">>;
export interface GarminStore {
  read(userId: string): Promise<GarminConnection | null>;
  initialize(userId: string): Promise<GarminConnection>;
  claim(row: GarminConnection, operation: GarminOperation, seconds: number, exchange?: boolean): Promise<GarminConnection | null>;
  finish(row: GarminConnection, patch: GarminPatch, expired?: boolean): Promise<boolean>;
  checkpoint(row: GarminConnection, patch: GarminPatch): Promise<GarminConnection>;
  saveTransaction(transaction: GarminTransaction): Promise<void>;
  consume(userId: string, stateHash: string, bindingHash: string): Promise<GarminTransaction | null>;
  invalidate(userId: string, connectionVersion: string): Promise<void>;
}
export class GarminStorageError extends Error {
  constructor(public duplicate = false) { super("Garmin connection storage unavailable"); }
}

export function createGarminStore(): GarminStore {
  const config = getAuthConfig();
  const secret = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!config || !secret) throw new GarminStorageError();
  // No caller headers/cookies. These tables have no anon/authenticated privileges.
  const db = createClient(config.url, secret, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  return garminStore(db);
}

export function garminStore(db: SupabaseClient, now = Date.now): GarminStore {
  const checked = <T>(result: { data: T; error: { code?: string } | null }): T => {
    if (result.error) throw new GarminStorageError(result.error.code === "23505");
    return result.data;
  };
  const read = async (userId: string) => checked(await db.from("garmin_connections").select("*").eq("user_id", userId).maybeSingle()) as GarminConnection | null;
  return {
    read,
    async initialize(userId) {
      checked(await db.from("garmin_connections").upsert({ user_id: userId }, { onConflict: "user_id", ignoreDuplicates: true }));
      const row = await read(userId);
      if (!row) throw new GarminStorageError();
      return row;
    },
    async claim(row, operation, seconds, exchange = false) {
      let query = db.from("garmin_connections").update({ operation, version: randomUUID(), lease_until: new Date(now() + seconds * 1000).toISOString(),
        ...(operation === "authorize" ? { deregistered_at: null } : {}),
        ...(operation === "delete" ? { deletion_requested_at: row.deletion_requested_at ?? new Date(now()).toISOString() } : {}) })
        .eq("user_id", row.user_id).eq("version", row.version);
      if (operation === "delete") query = query.or(`operation.is.null,and(operation.eq.delete,lease_until.lt.${new Date(now()).toISOString()})`);
      else if (exchange) query = query.is("deletion_requested_at", null).eq("operation", "authorize").gt("lease_until", new Date(now()).toISOString());
      else query = query.is("deletion_requested_at", null).or(`operation.is.null,lease_until.lt.${new Date(now()).toISOString()}`);
      return checked(await query.select("*").maybeSingle()) as GarminConnection | null;
    },
    async finish(row, patch, expired = false) {
      let query = db.from("garmin_connections").update({ ...patch, operation: null, lease_until: null, version: randomUUID() })
        .eq("user_id", row.user_id).eq("version", row.version);
      query = expired ? query.lt("lease_until", new Date(now()).toISOString()) : query.gt("lease_until", new Date(now()).toISOString());
      const result = checked(await query.select("user_id").maybeSingle());
      return result !== null;
    },
    async checkpoint(row, patch) {
      const result = checked(await db.from("garmin_connections").update(patch).eq("user_id", row.user_id).eq("version", row.version)
        .gt("lease_until", new Date(now()).toISOString()).select("*").maybeSingle()) as GarminConnection | null;
      if (!result) throw new GarminStorageError();
      return result;
    },
    async saveTransaction(transaction) { checked(await db.from("garmin_oauth_transactions").upsert(transaction, { onConflict: "user_id" })); },
    async consume(userId, stateHash, bindingHash) {
      // DELETE RETURNING is one database statement: concurrent callbacks get at most one row.
      return checked(await db.from("garmin_oauth_transactions").delete().eq("user_id", userId)
        .eq("state_hash", stateHash).eq("binding_hash", bindingHash).gt("expires_at", new Date(now()).toISOString())
        .select("*").maybeSingle()) as GarminTransaction | null;
    },
    async invalidate(userId, connectionVersion) { checked(await db.from("garmin_oauth_transactions").delete().eq("user_id", userId).eq("connection_version", connectionVersion)); },
  };
}
