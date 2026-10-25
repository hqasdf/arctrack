// Retain slot ordering while a screen unmounts and the same Round is reopened.
const pending = new Map<string, Promise<void>>();
const prefix = (owner: string, round: string) => `${owner}:${round}:`;
export function enqueueArrowWrite(owner: string, round: string, slot: string, task: () => Promise<void>): Promise<void> {
  const key = prefix(owner, round) + slot;
  const job = (pending.get(key) ?? Promise.resolve()).catch(() => {}).then(task);
  pending.set(key, job);
  const cleanup = () => { if (pending.get(key) === job) pending.delete(key); };
  void job.then(cleanup, cleanup);
  return job;
}
export async function waitForRoundWrites(owner: string, round: string): Promise<void> {
  const jobs = [...pending].filter(([key]) => key.startsWith(prefix(owner, round))).map(([, job]) => job);
  await Promise.all(jobs.map(job => job.catch(() => {})));
}
