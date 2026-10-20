import { PASSKEY_SESSION_ADOPTION_READY } from "./feature";
import type { PasskeyListItem } from "@supabase/supabase-js";

type PreparedOperations = {
  register: () => Promise<PasskeyListItem>;
  list: () => Promise<PasskeyListItem[]>;
  remove: (credentialId: string) => Promise<void>;
};

// Coordinates only prepared, nonpersistent operations. It intentionally has no
// Supabase persistent client, session writer or protected-route callback.
export function createPasskeyOperationCoordinator(dependencies: {
  assertAllowed: () => void;
  getOwnerId: () => string | null;
  createService: (isCurrent: () => boolean) => PreparedOperations;
}) {
  let generation = 0, disposed = false, foreground = true, pending = false;
  function invalidate() { generation++; }
  async function run<T>(action: (service: PreparedOperations) => Promise<T>): Promise<T> {
    dependencies.assertAllowed();
    if (disposed || !foreground) throw Error("Biometric Sign-In is unavailable.");
    if (pending) throw Error("A device authentication operation is already in progress.");
    const ownerId = dependencies.getOwnerId();
    if (!ownerId) throw Error("Sign in before managing Biometric Sign-In.");
    const lease = ++generation;
    const isCurrent = () => !disposed && foreground && generation === lease && dependencies.getOwnerId() === ownerId;
    pending = true;
    try {
      const result = await action(dependencies.createService(isCurrent));
      if (!isCurrent()) throw Error("Device authentication operation was abandoned.");
      return result;
    } finally { pending = false; }
  }
  return {
    register: () => run(service => service.register()),
    list: () => run(service => service.list()),
    remove: (credentialId: string) => run(service => service.remove(credentialId)),
    async authenticate(): Promise<never> {
      // No fallback to the old unsafe persistent verification flow. Adoption is
      // blocked even if a caller bypasses the presentation feature flag.
      if (!PASSKEY_SESSION_ADOPTION_READY) throw Error("Biometric Sign-In session adoption has not been enabled.");
      throw Error("Biometric Sign-In session adoption has not been implemented.");
    },
    invalidate,
    setForeground(value: boolean) { foreground = value; if (!value) invalidate(); },
    dispose() { disposed = true; invalidate(); },
  };
}
