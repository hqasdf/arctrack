import {useCallback,useRef,useState} from 'react';
import {useFocusEffect,router} from 'expo-router';
import {ActivityIndicator,Alert,AppState,Pressable,StyleSheet,Text,View} from 'react-native';
import {useAppearance,createThemedStyles} from './appearance';
import {readTrainingInvitations,readAthleteTraining,trainingAction,watchAthleteTraining,type TrainingInvitation,type AthleteTrainingDetail} from './live-coaching';
import {createMobileSession} from './writes';

/** Runs only while this screen is focused and foregrounded; coalesces invalidations. */
export function useTrainingRefresh(load:()=>Promise<void>,clear:()=>void,watch?:(changed:()=>void,unavailable:()=>void)=>()=>void){
 const request=useRef(()=>{}),current=useRef(false);
 useFocusEffect(useCallback(()=>{
  let alive=true,running=false,dirty=false,stop:undefined|(()=>void);
  const refresh=async()=>{if(!alive||AppState.currentState!=='active')return;dirty=true;if(running)return;running=true;try{while(dirty&&alive){dirty=false;await load();}}finally{running=false;}};
  const enter=()=>{if(AppState.currentState!=='active')return;current.current=true;void refresh();stop?.();stop=watch?.(()=>void refresh(),()=>{clear();void refresh();});};
  request.current=()=>void refresh();enter();
  const listener=AppState.addEventListener('change',state=>{if(state==='active')enter();else{current.current=false;stop?.();stop=undefined;clear();}});
  const timer=setInterval(()=>{if(AppState.currentState==='active')void refresh();},60000);
  return()=>{alive=false;current.current=false;stop?.();listener.remove();clearInterval(timer);request.current=()=>{};clear();};
 },[load,clear,watch]));
 return {refresh:()=>request.current(),current};
}
function Action({label,onPress,disabled=false}:{label:string;onPress:()=>void;disabled?:boolean}){const styles=useStyles();return <Pressable accessibilityRole='button' accessibilityState={{disabled,busy:disabled}} disabled={disabled} onPress={onPress} style={({pressed})=>[styles.button,(pressed||disabled)&&styles.dim]}><Text style={styles.buttonText}>{label}</Text></Pressable>;}
export function MobileTrainingInvitations({userId,organizationId}:{userId:string;organizationId:string}){
 const styles=useStyles(),{colors}=useAppearance();const [items,setItems]=useState<TrainingInvitation[]|null>(null),[error,setError]=useState('');const epoch=useRef(0);
 const [selected,setSelected]=useState<string|null>(null);
 const [attempts,setAttempts]=useState<Record<string,CreationAttempt>>({});
 const clear=useCallback(()=>{epoch.current++;setItems(null);},[]);
 const load=useCallback(async()=>{const ticket=++epoch.current;try{const value=await readTrainingInvitations(userId,organizationId);if(ticket===epoch.current&&AppState.currentState==='active'){setItems(value);setError('');}}catch(e){if(ticket===epoch.current){setItems(null);setError(e instanceof Error?e.message:'Invitations unavailable.');}}},[userId,organizationId]);
 const {refresh}=useTrainingRefresh(load,clear);
 return <View style={styles.section}><Text accessibilityRole='header' style={styles.heading}>Training invitations</Text><Text style={styles.muted}>Join a training, then choose a scoring Session to share. Organisation membership is separate.</Text>
 {error?<View><Text accessibilityRole='alert' style={styles.error}>{error}</Text><Action label='Retry invitations' onPress={refresh}/></View>:null}
 {!items&&!error?<ActivityIndicator accessibilityLabel='Loading invitations' color={colors.accent}/>:null}
 {items?.length===0?<Text style={styles.muted}>No current training invitations. New invitations appear here automatically.</Text>:null}
 {items?.map(item=>selected===item.id?<TrainingCard key={userId+':'+item.id} userId={userId} invitation={item} onUpdated={refresh}
   onClose={()=>setSelected(null)} attempt={attempts[item.id]} onAttempt={value=>setAttempts(previous=>({...previous,[item.id]:value}))}/>
   :<View key={item.id} style={styles.card}><Text style={styles.badge}>{item.participation_state} | {item.state}</Text>
     <Text accessibilityRole='header' style={styles.heading}>{item.title}</Text><Text style={styles.muted}>Coach: {item.coach_name||'Name not provided'}</Text>
     <Text style={styles.muted}>{item.training_date}</Text><Action label={item.participation_state==='invited'?'Respond to invitation':'Open Training'} onPress={()=>setSelected(item.id)}/></View>)}
 </View>;
}
type CreationAttempt={createdId:string|null;uncertain:boolean};
function TrainingCard({userId,invitation,onUpdated,onClose,attempt,onAttempt}:{userId:string;invitation:TrainingInvitation;onUpdated:()=>void;onClose?:()=>void;attempt?:CreationAttempt;onAttempt?:(value:CreationAttempt)=>void}){
 const styles=useStyles();const [detail,setDetail]=useState<AthleteTrainingDetail|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[choosing,setChoosing]=useState(false),[notice,setNotice]=useState(''),[creationState,setCreationState]=useState<'new'|'uncertain'|'created'>(attempt?.createdId?'created':attempt?.uncertain?'uncertain':'new');
 const saving=useRef(false),epoch=useRef(0),created=useRef<string|null>(attempt?.createdId??null),creationUncertain=useRef(attempt?.uncertain??false);
 const clear=useCallback(()=>{epoch.current++;setDetail(null);},[]);
 const load=useCallback(async()=>{const ticket=++epoch.current;try{const value=await readAthleteTraining(userId,invitation.id);if(ticket===epoch.current&&AppState.currentState==='active'){setDetail(value);}}catch(e){if(ticket===epoch.current){setDetail(null);setError(e instanceof Error?e.message:'Training unavailable.');}}},[userId,invitation.id]);
 const watch=useCallback((change:()=>void,unavailable:()=>void)=>watchAthleteTraining(userId,invitation.id,change,unavailable),[userId,invitation.id]);
 const {refresh,current}=useTrainingRefresh(load,clear,watch);
 const me=detail?.participants.find(p=>p.athleteId===userId);const open=detail&&['waiting','active'].includes(detail.session.state);
 async function change(action:'join'|'decline'|'leave'|'link',sessionId?:string){
  if(saving.current||!detail)return;saving.current=true;setBusy(true);setError('');setNotice('');
  try{await trainingAction(userId,detail.session,action,sessionId);if(current.current){setNotice(action==='join'?'Training joined. Connect a scoring Session.':action==='link'?'Scoring connection confirmed.':action==='leave'?'Training left. Your scoring history and organisation membership are unchanged.':'Invitation declined.');setChoosing(false);refresh();onUpdated();}}
  catch(e){if(current.current){setError(e instanceof Error?e.message:'Change not confirmed.');refresh();onUpdated();}}
  finally{saving.current=false;if(current.current)setBusy(false);}
 }
 async function createAndConnect(){
  // A creation may finish after this detail was backgrounded/unmounted. Adopt
  // its parent-retained identity before retrying the association, never recreate.
  if(!created.current&&attempt?.createdId){created.current=attempt.createdId;creationUncertain.current=false;}
  if(saving.current||!detail||creationUncertain.current&&!created.current)return;saving.current=true;setBusy(true);setError('');
  try{
   // Reverify membership/state before creating, and retain the created Session across link retries.
   const latest=await readAthleteTraining(userId,invitation.id);
   if(!current.current)return;
   if(latest.participants[0]?.state!=='joined'||!['waiting','active'].includes(latest.session.state))throw Error('Join an open training before connecting scoring.');
   if(!created.current){creationUncertain.current=true;setCreationState('uncertain');onAttempt?.({createdId:null,uncertain:true});const result=await createMobileSession(userId,{title:invitation.title,date:latest.session.training_date,sessionType:'training'});created.current=result.id;creationUncertain.current=false;onAttempt?.({createdId:result.id,uncertain:false});if(current.current)setCreationState('created');}
   if(!current.current)return;
   await trainingAction(userId,latest.session,'link',created.current);
   if(current.current){setNotice('Scoring connection confirmed.');setChoosing(false);refresh();onUpdated();}
  }catch(e){if(current.current){setError((e instanceof Error?e.message:'Connection not confirmed.')+(creationUncertain.current?' Creation may have completed. Reload and select the existing Session below instead of creating another.':''));refresh();}}
  finally{saving.current=false;if(current.current)setBusy(false);}
 }
 function leave(){Alert.alert('Leave this training?','This ends live scoring and HR sharing for this training. Your scoring history stays saved and you remain in your organisation.',[{text:'Stay in training',style:'cancel'},{text:'Leave Training',style:'destructive',onPress:()=>void change('leave')}]);}
 return <View style={styles.card}><Text style={styles.badge}>{me?.state??invitation.participation_state} | {detail?.session.state??invitation.state}</Text><Text accessibilityRole='header' style={styles.heading}>{invitation.title}</Text><Text style={styles.muted}>Coach: {invitation.coach_name||'Name not provided'}</Text><Text style={styles.muted}>{invitation.training_date}</Text>
 {onClose?<Action label='Close training details' onPress={onClose} disabled={busy}/>:null}
 {notice?<Text accessibilityLiveRegion='polite' style={styles.muted}>{notice}</Text>:null}
 {error?<><Text accessibilityRole='alert' style={styles.error}>{error}</Text><Action label='Reload training' onPress={()=>{refresh();onUpdated();}} disabled={busy}/></>:null}
 {!detail&&!error?<ActivityIndicator accessibilityLabel='Checking training access'/>:null}
 {open&&me?.state==='invited'?<View style={styles.actions}><Action label='Join Training' disabled={busy} onPress={()=>void change('join')}/><Action label='Decline' disabled={busy} onPress={()=>void change('decline')}/></View>:null}
 {detail?.session.state==='created'?<Text style={styles.muted}>Your coach has not opened joining yet.</Text>:null}
 {me?.state==='joined'?<>
 {me.scoringSessionId?<Action label='Continue Scoring' disabled={busy} onPress={()=>router.push({pathname:'/sessions/[sessionId]',params:{sessionId:me.scoringSessionId!}})}/>:<Text style={styles.muted}>Awaiting scoring connection. Scores remain private until you connect a Session.</Text>}
 {open?<><Action label={me.scoringSessionId?'Change scoring connection':'Connect Scoring Session'} disabled={busy} onPress={()=>setChoosing(v=>!v)}/><Action label='Leave Training' disabled={busy} onPress={leave}/></>:null}
 {choosing&&open?<View style={styles.section}><Text style={styles.muted}>Your training Sessions on {detail.session.training_date}. Selecting one explicitly shares its saved scores with your coach.</Text>{detail.eligibleSessions.map(s=><Action key={s.id} label={'Connect '+s.title} disabled={busy} onPress={()=>void change('link',s.id)}/>)}{!detail.eligibleSessions.length?<Text style={styles.muted}>No eligible scoring Sessions yet.</Text>:null}<Action label={attempt?.createdId||creationState==='created'?'Retry scoring connection':'Create and connect new Session'} disabled={busy||creationState==='uncertain'&&!attempt?.createdId} onPress={()=>void createAndConnect()}/></View>:null}
 </>:null}
 {detail&&!open&&detail.session.state!=='created'?<Text style={styles.muted}>Training {detail.session.state}. Your saved scoring Sessions remain yours.</Text>:null}
 </View>;
}
const useStyles=createThemedStyles(colors=>StyleSheet.create({section:{gap:12,marginTop:18},card:{gap:12,padding:18,borderRadius:16,borderWidth:1,borderColor:colors.border,backgroundColor:colors.surface},heading:{color:colors.text,fontSize:20,fontWeight:'600',flexShrink:1},muted:{color:colors.muted,lineHeight:21,fontSize:14},badge:{color:colors.accent,fontSize:12,fontWeight:'700',textTransform:'capitalize'},actions:{gap:10},button:{minHeight:48,padding:12,borderWidth:1,borderRadius:12,borderColor:colors.border,backgroundColor:colors.control,justifyContent:'center'},buttonText:{color:colors.accent,fontSize:15,fontWeight:'600',flexShrink:1},error:{color:colors.error,lineHeight:21},dim:{opacity:.55}}));
