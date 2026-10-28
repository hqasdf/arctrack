import type {HrDevice} from './sensor-manager';

// A browser permission and device object remain in memory only, scoped to this
// signed-in coach and organization. A reload or different account starts fresh.
let tested: {scope:string;device:HrDevice}|null=null;
export const testedDevice=(scope:string)=>tested?.scope===scope?tested.device:undefined;
export function rememberTestedDevice(scope:string,device:HrDevice){tested={scope,device};}
