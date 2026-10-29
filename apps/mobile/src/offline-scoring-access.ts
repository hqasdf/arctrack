/** Offline unlock is a separate device-only capability, never an authenticated
 * network identity. It can only use an already accepted secure authority record.
 */
export function deviceScoringOwner(snapshot: {
  ready: boolean; retiring: boolean; error: unknown;
  accepted: { accountId: string; mode: string } | null;
} | undefined): string | null {
  return snapshot?.ready && !snapshot.retiring && !snapshot.error && snapshot.accepted?.mode === "normal"
    ? snapshot.accepted.accountId : null;
}
