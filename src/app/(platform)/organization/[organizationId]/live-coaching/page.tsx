import {requireCoachOrganization} from '@/features/organizations/coach-read.server';
import {requireUser} from '@/lib/auth/session.server';
import {LiveCoaching} from '@/features/live-coaching/live-coaching';
export const metadata={title:'Live Coaching'};
export default async function CoachLivePage({params,searchParams}:{params:Promise<{organizationId:string}>;searchParams:Promise<{session?:string}>}){const {organizationId}=await params;await requireCoachOrganization(organizationId);const user=await requireUser();const query=await searchParams;return <LiveCoaching key={user.id+':'+organizationId+':'+(query.session??'index')} organizationId={organizationId} viewerId={user.id} sessionId={query.session} basePath={`/organization/${organizationId}/live-coaching`}/>;}
