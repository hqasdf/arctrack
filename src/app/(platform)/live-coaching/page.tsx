import {requireUser} from '@/lib/auth/session.server';
import {LiveCoaching} from '@/features/live-coaching/live-coaching';
import {AthleteInvitations} from '@/features/live-coaching/athlete-invitations';
export const metadata={title:'Live Coaching'};
export default async function LivePage({searchParams}:{searchParams:Promise<{session?:string}>}){const user=await requireUser();const params=await searchParams;return params.session?<LiveCoaching key={user.id+':'+params.session} sessionId={params.session}/>:<AthleteInvitations key={user.id}/>;}
