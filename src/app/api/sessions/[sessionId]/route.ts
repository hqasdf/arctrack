import { readIdentity } from "@/lib/auth/session.server";
import { readOwnedSession } from "@/features/sessions/read.server";
import { isUuid } from "@/features/sessions/validation";

const headers={"Cache-Control":"private, no-store"};
export async function GET(_request:Request,{params}:{params:Promise<{sessionId:string}>}) {
  const {sessionId}=await params;
  if(!isUuid(sessionId))return Response.json({error:"Invalid Session."},{status:400,headers});
  const identity=await readIdentity();
  if(!identity.user)return Response.json({error:"Sign in to refresh this Session."},{status:identity.unavailable?503:401,headers});
  try{
    const session=await readOwnedSession(sessionId);
    return session?Response.json({session},{headers}):Response.json({error:"Session no longer available."},{status:404,headers});
  }catch{return Response.json({error:"Session refresh unavailable. Device changes were preserved."},{status:503,headers});}
}
