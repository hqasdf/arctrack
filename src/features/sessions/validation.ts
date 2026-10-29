import type { Plot, ScoreLabel, SessionType, TargetFaceType } from "./scoring-model";

const UUID_PATTERN=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIVISIONS=["Recurve","Compound","Barebow","Other"] as const;
const SCORE_LABELS:ScoreLabel[]=["X","10","9","8","7","6","5","4","3","2","1","M"];
const FACE_TYPES:TargetFaceType[]=["full_face","six_ring","triple_face"];
const SESSION_TYPES:SessionType[]=["training","competition"];

export type SessionInput={title:string;date:string;sessionType:string};
export type SessionArrowCountInput={sessionId:string;arrowCount:number};
export type RoundInput={sessionId:string;name:string;division:string;distanceMetres:number;faceDiameterCm:number;faceType:string;ends:number;arrowsPerEnd:number};
export type ArrowInput={roundId:string;endNumber:number;arrowNumber:number;score:string;plot:Plot|null};

export function validateSessionInput(input:SessionInput) {
  const title=input.title.trim()||"Practice session";
  if (Array.from(title).length>80) return {ok:false as const,message:"Session titles must be 80 characters or fewer."};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)||Number.isNaN(Date.parse(`${input.date}T00:00:00Z`))) return {ok:false as const,message:"Choose a valid Session date."};
  if (!SESSION_TYPES.includes(input.sessionType as SessionType)) return {ok:false as const,message:"Choose a valid Session type."};
  return {ok:true as const,value:{title,date:input.date,sessionType:input.sessionType as SessionType}};
}

export function validateSessionArrowCount(input:SessionArrowCountInput) {
  if (!isUuid(input.sessionId)) return {ok:false as const,message:"The Session could not be identified."};
  if (!Number.isInteger(input.arrowCount)||input.arrowCount<0||input.arrowCount>2147483647) return {ok:false as const,message:"Arrow count must be a non-negative whole number."};
  return {ok:true as const,value:input};
}

export function validateRoundInput(input:RoundInput) {
  const name=input.name.trim();
  if (!isUuid(input.sessionId)) return {ok:false as const,message:"The Session could not be identified."};
  if (!name||Array.from(name).length>80) return {ok:false as const,message:"Round names must contain 1 to 80 characters."};
  if (!DIVISIONS.includes(input.division as (typeof DIVISIONS)[number])) return {ok:false as const,message:"Choose a valid division."};
  if (!FACE_TYPES.includes(input.faceType as TargetFaceType)) return {ok:false as const,message:"Choose a valid target-face layout."};
  const numbers=[input.distanceMetres,input.faceDiameterCm,input.ends,input.arrowsPerEnd];
  if(input.ends>120||input.arrowsPerEnd>60)return {ok:false as const,message:"Rounds support up to 120 Ends and 60 Arrows per End."};
  if (numbers.some((value)=>!Number.isInteger(value)||value<1||value>32767)) return {ok:false as const,message:""};
  return {ok:true as const,value:{...input,name,division:input.division as (typeof DIVISIONS)[number],faceType:input.faceType as TargetFaceType}};
}

export function validateArrowInput(input:ArrowInput) {
  if (!isUuid(input.roundId)) return {ok:false as const,message:"The Round could not be identified."};
  if (![input.endNumber,input.arrowNumber].every((value)=>Number.isInteger(value)&&value>=1&&value<=32767)) return {ok:false as const,message:"The Arrow position is invalid."};
  if (!SCORE_LABELS.includes(input.score as ScoreLabel)) return {ok:false as const,message:"The Arrow score is invalid."};
  if (input.plot) {
    if (![input.plot.x,input.plot.y].every((value)=>Number.isFinite(value)&&Math.abs(value)<=2)) return {ok:false as const,message:"The plotted position is invalid."};
    if (input.plot.faceIndex!==undefined&&![0,1,2].includes(input.plot.faceIndex)) return {ok:false as const,message:"The triple-face position is invalid."};
  }
  const score=input.score as ScoreLabel;
  return {ok:true as const,value:{...input,score,scorePoints:score==="X"?10:score==="M"?0:Number(score),isX:score==="X"}};
}

export function isUuid(value:string) { return UUID_PATTERN.test(value); }
