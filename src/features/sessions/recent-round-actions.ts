'use server';
import { requireUser } from '@/lib/auth/session.server';
import { createAuthClient } from '@/lib/supabase/server';
import { readRecentRoundConfigurations, forgetRecentRoundConfiguration } from '@arc-track/core/recent-round-configs';

async function ownerClient(expectedUser: string) {
  const user = await requireUser();
  if (user.id !== expectedUser) throw Error('Your account changed. Reopen Configure Round.');
  return createAuthClient({ writable: true });
}
export async function readRecentRounds(userId: string) {
  return readRecentRoundConfigurations(await ownerClient(userId), userId);
}
export async function forgetRecentRound(userId: string, id: string) {
  await forgetRecentRoundConfiguration(await ownerClient(userId), userId, id);
}
