import { createNativePasskeyAdapter } from "./native-adapter";
import { createPreparedPasskeyService, type PasskeyOwnerSession } from "./service";
import { createPasskeyOperationCoordinator } from "./coordinator";
import { assertPasskeysAllowed, PASSKEY_RELYING_PARTY_ID } from "./feature";

// Uses the existing application's configuration. No alternate identity/backend,
// persistent client, session writer, auth listener or automatic native prompt.
export function createApplicationPasskeyProvider(input: {
  supabaseUrl: string; publishableKey: string;
  currentOwner: () => PasskeyOwnerSession | null;
}) {
  const { currentOwner, supabaseUrl, publishableKey } = input;
  return createPasskeyOperationCoordinator({
    assertAllowed: assertPasskeysAllowed,
    getOwnerId: () => currentOwner()?.userId ?? null,
    createService: isCurrent => createPreparedPasskeyService({
      environment: { supabaseUrl, publishableKey, relyingPartyId: PASSKEY_RELYING_PARTY_ID,
        assertAllowed: assertPasskeysAllowed },
      native: createNativePasskeyAdapter(), currentOwner, isCurrent,
    }),
  });
}
