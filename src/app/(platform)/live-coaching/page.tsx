import {requireUser} from '@/lib/auth/session.server';
import {LiveCoaching} from '@/features/live-coaching/live-coaching';
export const metadata={title:'Live Coaching'};
export default async function LivePage({searchParams}:{searchParams:Promise<{session?:string}>}){const user=await requireUser();const params=await searchParams;return <LiveCoaching key={user.id+':'+(params.session??'index')} sessionId={params.session}/>;}
