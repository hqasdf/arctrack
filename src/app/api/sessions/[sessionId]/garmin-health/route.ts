import { sessionHealthRequest } from '@/features/session-health/http.server';
export const dynamic='force-dynamic';
export async function GET(request:Request,context:{params:Promise<{sessionId:string}>}) {return sessionHealthRequest(request,(await context.params).sessionId);}
export async function POST(request:Request,context:{params:Promise<{sessionId:string}>}) {return sessionHealthRequest(request,(await context.params).sessionId);}
