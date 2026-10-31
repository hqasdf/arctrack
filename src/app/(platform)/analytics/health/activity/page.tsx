import {requireUser} from '@/lib/auth/session.server';
import {ActivityDetails} from '@/features/session-health/activity-details';
export default async function ActivityPage({searchParams}:{searchParams:Promise<{activityId?:string}>}){
 const user=await requireUser();const {activityId}=await searchParams;
 return <ActivityDetails key={`${user.id}:${activityId??''}`} activityId={activityId??''}/>;
}
