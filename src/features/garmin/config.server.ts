import "server-only";
import { getAuthConfig } from "@/lib/auth/config";

export const GARMIN_CALLBACK_PATH = "/api/integrations/garmin/callback";
// Only new authorization is gated. Keep provider configuration available for cleanup.
export function mayConnectGarmin(userId: string): boolean {
  if (process.env.GARMIN_CONNECT_ENABLED !== "true") return false;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  // The caller supplies the verified Supabase identity, never a submitted user ID.
  return uuid.test(userId);
}
export type GarminConfig = {
  clientId: string; clientSecret: string; redirectUri: string; appOrigin: string;
  encryptionKey: Buffer; cookieName: string; secure: boolean;
};

export function getGarminConfig(): GarminConfig | null {
  const auth = getAuthConfig();
  const clientId = process.env.GARMIN_CLIENT_ID?.trim();
  const clientSecret = process.env.GARMIN_CLIENT_SECRET?.trim();
  const encodedKey = process.env.GARMIN_TOKEN_ENCRYPTION_KEY?.trim();
  const redirect = process.env.GARMIN_REDIRECT_URI?.trim();
  if (!auth || !clientId || !clientSecret || !encodedKey || !redirect || !process.env.SUPABASE_SECRET_KEY?.trim()) return null;
  try {
    const url = new URL(redirect);
    const key = Buffer.from(encodedKey, "base64");
    if (url.origin !== auth.appUrl || url.pathname !== GARMIN_CALLBACK_PATH || url.search || url.hash
      || url.username || url.password || key.length !== 32 || key.toString("base64") !== encodedKey) return null;
    const secure = url.protocol === "https:";
    return { clientId, clientSecret, encryptionKey: key, redirectUri: url.href, appOrigin: auth.appUrl,
      secure, cookieName: secure ? "__Secure-arctrack-garmin" : "arctrack-garmin" };
  } catch { return null; }
}
