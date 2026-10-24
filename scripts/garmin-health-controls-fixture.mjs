/** Maintained concurrency regression; invoked only by the owned disposable runner. */
import { randomUUID } from "node:crypto";

export async function testHealthControlConcurrency(db, Client, configuration, check) {
  const other = new Client(configuration); await other.connect();
  const user = "93000000-0000-4000-8000-000000000001";
  const version = async () => (await db.query("select generation from public.garmin_health_controls where user_id=$1", [user])).rows[0].generation;
  const mutate = (client, action, generation, requestId = randomUUID()) => client.query("select public.control_garmin_health($1,$2,$3,$4,c.version,c.authorized_at) as value from public.garmin_connections c where c.user_id=$1", [user, action, generation, requestId]);
  const stage = client => client.query(`select public.stage_garmin_health_push(jsonb_build_array(jsonb_build_object(
    'garminUserId','controls-concurrent','kind','dailies','sourceId','concurrent','recordKey','concurrent',
    'hash',repeat('d',64),'calendarDate','2026-10-24','startTimeInSeconds',floor(extract(epoch from clock_timestamp()))-1,
    'durationInSeconds',1,'values','{"steps":450}'::jsonb)),array[$1]::uuid[]) as value`, [user]);
  const process = client => client.query("select public.process_garmin_health_queue(array[$1]::uuid[],25) as value", [user]);
  async function waitForLock(pid) {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      if ((await db.query("select pg_backend_pid()=any(pg_blocking_pids($1)) as blocked", [pid])).rows[0].blocked) return;
    }
    throw Error("Independent control request never reached the expected row lock.");
  }
  try {
    await db.query("insert into auth.users values($1,'control-race@example.invalid')", [user]);
    await db.query(`insert into public.garmin_connections(user_id,garmin_user_id,status,token_ciphertext,access_expires_at,refresh_after,authorized_at,permissions)
      values($1,'controls-concurrent','connected','synthetic',now()+interval '1 day',now()+interval '1 day','2026-10-23T00:00:00Z','["HEALTH_EXPORT","ACTIVITY_EXPORT"]')`, [user]);
    const pid = (await other.query("select pg_backend_pid() as pid")).rows[0].pid;
    await stage(db);
    const initial = await version();
    await db.query("begin"); await process(db);
    const deleting = mutate(other, "delete", initial);
    await waitForLock(pid);
    check(true, "Deletion waits for an already-processing worker using the same connection lock");
    await db.query("commit"); await deleting;
    check((await db.query("select count(*)::int n from public.garmin_health_records where user_id=$1", [user])).rows[0].n === 0,
      "Worker finishing before Delete cannot leave resurrected records after Delete commits");
    check((await other.query("select paused from public.garmin_health_controls where user_id=$1", [user])).rows[0].paused,
      "Pause persists across independent clients, with no in-memory authority");
    await mutate(db, "resume", await version());
    await db.query("update public.garmin_health_controls set accept_after=clock_timestamp()-interval '5 seconds' where user_id=$1", [user]);
    await stage(db);
    await db.query("begin"); await mutate(db, "delete", await version());
    check((await process(other)).rows[0].value === 0, "Worker skips a connection with deletion in progress");
    const arriving = stage(other); await waitForLock(pid);
    await db.query("commit");
    check((await arriving).rows[0].value === 0, "Webhook waiting before deletion cannot stage data after the pause commits");
    const request = randomUUID(), generation = await version();
    const repeated = await Promise.all([mutate(db, "delete", generation, request), mutate(other, "delete", generation, request)]);
    check(repeated[0].rows[0].value.generation === repeated[1].rows[0].value.generation,
      "Concurrent identical deletion requests return one durable action receipt");
    await mutate(db, "resume", await version());
    await db.query("update public.garmin_health_controls set accept_after=clock_timestamp()-interval '5 seconds' where user_id=$1", [user]);
    await stage(db); await process(db);
    const before = await version();
    await db.query("begin"); await mutate(db, "delete", before); await db.query("rollback");
    check(await version() === before && (await db.query("select count(*)::int n from public.garmin_health_records where user_id=$1", [user])).rows[0].n === 1,
      "Interrupted uncommitted deletion rolls back the fence and cleanup together without reporting success");
    await mutate(db, "delete", before);
    await other.end();
    const restarted = new Client(configuration); await restarted.connect();
    try { check((await restarted.query("select paused from public.garmin_health_controls where user_id=$1", [user])).rows[0].paused,
      "A newly initialized application database client restores durable paused state"); } finally { await restarted.end(); }
  } finally {
    await db.query("rollback");
    await other.end().catch(() => {});
  }
}
