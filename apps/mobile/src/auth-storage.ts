type Storage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

/** Supabase keys are unchanged; migration never writes tokens to legacy storage. */
export function createAuthStorage(secure: Storage, legacy: Storage, reportFailure: () => void): Storage {
  const pending = new Map<string, Promise<unknown>>();

  // A migration read must not finish after a newer write or logout of that key.
  function serialize<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const result = (pending.get(key) ?? Promise.resolve()).catch(() => {}).then(operation);
    pending.set(key, result);
    void result.finally(() => { if (pending.get(key) === result) pending.delete(key); }).catch(() => {});
    return result;
  }

  async function readSecure(key: string) {
    try { return await secure.getItem(key); }
    catch { throw new Error("Auth secure storage could not be read."); }
  }

  async function writeSecure(key: string, value: string) {
    try {
      await secure.setItem(key, value);
      if (await secure.getItem(key) !== value) throw new Error();
    } catch { throw new Error("Auth secure storage could not be saved."); }
  }

  async function cleanLegacy(key: string) {
    try { await legacy.removeItem(key); }
    catch { reportFailure(); }
  }

  return {
    getItem: (key) => serialize(key, async () => {
      const saved = await readSecure(key);
      if (saved !== null) {
        await cleanLegacy(key);
        return saved;
      }
      let previous: string | null;
      try { previous = await legacy.getItem(key); }
      catch { throw new Error("Auth legacy storage could not be read."); }
      if (previous === null) return null;
      try { await writeSecure(key, previous); }
      catch {
        // Keep the existing login usable and its only persisted copy intact.
        // The next read retries migration; ordinary writes still require SecureStore.
        reportFailure();
        return previous;
      }
      await cleanLegacy(key);
      return previous;
    }),
    setItem: (key, value) => serialize(key, async () => {
      await writeSecure(key, value);
      await cleanLegacy(key);
    }),
    removeItem: (key) => serialize(key, async () => {
      try {
        // Remove the legacy copy first: a failed cleanup must not leave it able
        // to resurrect a signed-out user when the secure copy disappears.
        await legacy.removeItem(key);
        await secure.removeItem(key);
      } catch { throw new Error("Auth storage could not be cleared."); }
    }),
  };
}
