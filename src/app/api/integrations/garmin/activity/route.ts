import {createAuthClient} from '@/lib/supabase/server';
import {ActivityAccessError,readImportedActivity} from '@/features/session-health/activity-read.server';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'};
export async function GET(request:Request){
 const id=new URL(request.url).searchParams.get('activityId');
 if(!id||id.length>180||/[\u0000-\u001f]/.test(id))return Response.json({error:'Activity unavailable.'},{status:400,headers});
 const db=await createAuthClient();const {data,error}=await db.auth.getUser();
 if(error||!data.user)return Response.json({error:'Sign in to view your activity.'},{status:401,headers});
 try{const detail=await readImportedActivity(db,data.user.id,id,request.headers.get('if-none-match')??undefined);if(detail?.unchanged)return new Response(null,{status:304,headers});return Response.json(detail??{error:'Activity unavailable.'},{status:detail?200:404,headers});}
 catch(error){return Response.json({error:'Activity access or measurements could not be verified.'},{status:error instanceof ActivityAccessError?403:503,headers});}
}
