import type { PasskeyListItem } from "@supabase/supabase-js";

export type CredentialStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};
export type CredentialScope = { ownerId: string; supabaseUrl: string; relyingPartyId: string };
export type DeviceCredentialState = { credentials: PasskeyListItem[]; registeredHere: string | null };
type Binding = { version: 1; ownerId: string; origin: string; relyingPartyId: string; credentialId: string };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hostname = /^[a-z0-9]+(?:[a-z0-9.-]*[a-z0-9])?$/;

// This record remembers a registration performed from this installation. It is
// not a claim that the credential is device-bound: providers may sync passkeys.
// It contains no token, password, private key or authentication authority.
export function createDeviceCredentialState(input: {
  scope: CredentialScope;
  storage: CredentialStorage;
  server: { list(): Promise<PasskeyListItem[]>; register(): Promise<PasskeyListItem>; remove(id: string): Promise<void> };
  revision: () => number;
  isCurrent: () => boolean;
}) {
  const { ownerId, relyingPartyId } = input.scope;
  const url = new URL(input.scope.supabaseUrl);
  if (!uuid.test(ownerId) || url.protocol !== "https:" || !hostname.test(url.hostname) ||
      url.username || url.password || url.search || url.hash || !["", "/"].includes(url.pathname) ||
      !hostname.test(relyingPartyId) || relyingPartyId.length > 253) throw Error("Invalid credential-state scope.");
  const origin = url.origin;
  const key = `arc-track.passkey-registration.v1.${url.hostname}.${url.port || "443"}.${relyingPartyId}.${ownerId}`;
  let pending: Promise<unknown> = Promise.resolve();

  function run<T>(action: (check: () => void) => Promise<T>): Promise<T> {
    const revision = input.revision();
    const check = () => {
      if (!input.isCurrent() || input.revision() !== revision) throw Error("Device authentication operation was abandoned.");
    };
    const result = pending.catch(() => {}).then(() => { check(); return action(check); });
    pending = result;
    return result;
  }
  async function read(check: () => void): Promise<Binding | null> {
    const raw = await input.storage.getItem(key); check();
    if (!raw) return null;
    let value: Binding;
    try { value = JSON.parse(raw); } catch { return null; }
    return value?.version === 1 && value.ownerId === ownerId && value.origin === origin &&
      value.relyingPartyId === relyingPartyId && typeof value.credentialId === "string" && uuid.test(value.credentialId)
      ? value : null;
  }
  async function reconcile(credentials: PasskeyListItem[], check: () => void): Promise<DeviceCredentialState> {
    const binding = await read(check);
    if (!binding) return { credentials, registeredHere: null };
    if (credentials.some(item => item.id === binding.credentialId)) return { credentials, registeredHere: binding.credentialId };
    // A confirmed missing server credential clears only metadata, never any
    // server credential or session. A failed list never reaches this branch.
    await input.storage.removeItem(key); check();
    return { credentials, registeredHere: null };
  }
  async function list(check: () => void) {
    const credentials = await input.server.list(); check();
    return credentials;
  }
  return {
    reconcile: () => run(async check => reconcile(await list(check), check)),
    register: () => run(async check => {
      const current = await reconcile(await list(check), check);
      if (current.registeredHere) return current;
      const registered = await input.server.register(); check();
      const credentials = await list(check);
      if (!uuid.test(registered.id) || !credentials.some(item => item.id === registered.id))
        throw Error("Registration could not be confirmed.");
      const binding: Binding = { version: 1, ownerId, origin, relyingPartyId, credentialId: registered.id };
      await input.storage.setItem(key, JSON.stringify(binding)); check();
      const saved = await read(check);
      if (saved?.credentialId !== registered.id) throw Error("Credential state could not be saved.");
      // Do not return Enabled if the credential disappeared while persisting.
      return reconcile(await list(check), check);
    }),
    remove: (id: string) => run(async check => {
      if (!uuid.test(id)) throw Error("Invalid credential.");
      const before = await list(check);
      if (before.some(item => item.id === id)) {
        await input.server.remove(id); check();
      }
      const after = await list(check);
      if (after.some(item => item.id === id)) throw Error("Credential removal could not be confirmed.");
      return reconcile(after, check);
    }),
  };
}
