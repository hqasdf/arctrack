/** Deterministic synthetic histories only; no account or provider records. */
export function coachHistoryFixture(count,athleteCount=1,seed=20261031){
 let state=seed>>>0;
 const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state;};
 const scores=['M','1','2','3','4','5','6','7','8','9','10','X'];
 const athletes=Array.from({length:athleteCount},(_,i)=>({userId:`synthetic-athlete-${i}`,name:`Synthetic Archer ${i%5}`}));
 const sessions=Array.from({length:count},(_,i)=>{
  const date=new Date(Date.UTC(2026,9,31)-i%450*86400000).toISOString().slice(0,10);
  const rounds=Array.from({length:i%5===0?2:1},(_,j)=>{
   const roundId=`synthetic-round-${i}-${j}`,faceType=['full_face','six_ring','triple_face'][(i+j)%3],arrowsPerEnd=(i+j)%2?9:6;
   const size=(i+j)%19===0?0:(i+j)%9===0?17:36;
   return {id:roundId,roundNumber:j+1,name:arrowsPerEnd===9?'9 × 4':'6 × 6',division:['Recurve','Compound','Barebow'][(i+j)%3],distanceMetres:[18,30,50,70][(i+j)%4],faceDiameterCm:(i+j)%3===0?122:40,faceType,ends:36/arrowsPerEnd,arrowsPerEnd,
    arrows:Array.from({length:size},(_,k)=>({id:`${roundId}-arrow-${k}`,end:Math.floor(k/arrowsPerEnd)+1,arrow:k%arrowsPerEnd+1,score:scores[random()%scores.length],syncState:'saved',
     plot:k%3===0?{x:(random()%2001-1000)/5000,y:(random()%2001-1000)/5000,...(faceType==='triple_face'&&k%11!==0?{faceIndex:k%3}:{})}:null})),
   };
  });
  return {id:`synthetic-session-${i}`,userId:athletes[i%athleteCount].userId,title:`Synthetic practice ${i}`,date,sessionType:i%4===0?'competition':'training',arrowCount:120+i%61,rounds};
 });
 return {athletes,sessions,today:'2026-10-31'};
}
