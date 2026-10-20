import * as SecureStore from "expo-secure-store";
import type { CredentialStorage } from "./credential-state";

// Share ordering across focused controllers in this JS process. This is only
// registration metadata, not the auth-session store or a crash-atomic journal.
const pending = new Map<string, Promise<unknown>>();
function serialize<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const result = (pending.get(key) ?? Promise.resolve()).catch(() => {}).then(operation);
  pending.set(key, result);
  void result.finally(() => { if (pending.get(key) === result) pending.delete(key); }).catch(() => {});
  return result;
}

export const deviceCredentialStorage: CredentialStorage = {
  getItem: key => serialize(key, () => SecureStore.getItemAsync(key)),
  setItem: (key, value) => serialize(key, () => SecureStore.setItemAsync(key, value, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  })),
  removeItem: key => serialize(key, () => SecureStore.deleteItemAsync(key)),
};
