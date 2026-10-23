export type GarminStatus = "disconnected" | "connected" | "reauthorization_required" | "error";
export type GarminOperation = "authorize" | "exchange" | "refresh" | "disconnect" | "delete";
export type GarminConnection = {
  user_id: string; garmin_user_id: string | null; status: GarminStatus;
  token_ciphertext: string | null; access_expires_at: string | null;
  refresh_expires_at: string | null; refresh_after: string | null;
  connected_at: string | null; authorized_at: string | null; checked_at: string | null;
  permissions: string[]; error_code: string | null;
  deletion_requested_at: string | null; deregistered_at: string | null;
  version: string; operation: GarminOperation | null; lease_until: string | null;
};
export type GarminTransaction = {
  user_id: string; state_hash: string; binding_hash: string;
  verifier_ciphertext: string; connection_version: string; redirect_uri: string;
  expires_at: string;
};
// Only this projection may reach client components. Never include provider tokens.
export type GarminView = {
  canConnect: boolean;
  available: boolean; status: GarminStatus | "connecting" | "disconnecting";
  permissions: string[]; authorizedAt: string | null; checkedAt: string | null;
  expiresAt: string | null;
  error: string | null;
};
