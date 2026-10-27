import { parseHeartRate } from './measurement';

export interface HrCharacteristic extends EventTarget { value?: DataView; startNotifications(): Promise<HrCharacteristic>; stopNotifications(): Promise<HrCharacteristic> }
export interface HrDevice extends EventTarget {
  id: string;
  gatt?: { connected: boolean; connect(): Promise<{ getPrimaryService(service: number): Promise<{ getCharacteristic(characteristic: number): Promise<HrCharacteristic> }> }>; disconnect(): void };
}
export interface BluetoothAdapter { requestDevice(options: { filters: { services: number[] }[] }): Promise<HrDevice> }
export type SensorLease = { generation: string; sourceId: string };
export type SensorState = { athleteId: string; state: 'connecting' | 'connected' | 'disconnected' | 'error'; message?: string };
type Entry = { device: HrDevice; characteristic?: HrCharacteristic; lease?: SensorLease; listener: EventListener; disconnected: EventListener; sequence: number; lastSent: number; stopped: boolean };

/** Hardware IDs stay in this browser's memory. Only random per-assignment IDs reach the server. */
export class HeartRateSensorManager {
  private entries = new Map<string, Entry>();
  private pending = new Set<string>();
  private cancelled = new Set<string>();
  private choosing = false;
  private disposed = false;
  constructor(private options: {
    bluetooth: BluetoothAdapter;
    authorize(athleteId: string, sourceId: string): Promise<SensorLease>;
    publish(athleteId: string, lease: SensorLease, sample: { bpm: number; sequence: number; receivedAt: string }): Promise<void>;
    release(athleteId: string, lease: SensorLease): Promise<void>;
    state(value: SensorState): void;
    now?: () => number;
  }) {}

  async connect(athleteId: string): Promise<void> {
    if (this.disposed || this.choosing || this.pending.has(athleteId)) return;
    if (!this.entries.has(athleteId) && this.entries.size >= 12) throw Error('Disconnect a sensor before adding another. Device limits vary.');
    this.pending.add(athleteId); this.cancelled.delete(athleteId); this.choosing = true;
    this.options.state({athleteId,state:'connecting'});
    let device: HrDevice | undefined, ownsChooser=true;
    try {
      // Must be called directly from an explicit click; no automatic discovery or prompts.
      device = await this.options.bluetooth.requestDevice({filters:[{services:[0x180d]}]});
      this.choosing = false;ownsChooser=false;
      if (this.disposed || this.cancelled.has(athleteId)) return;
      if ([...this.entries].some(([other,e])=>other!==athleteId && e.device.id===device!.id)) throw Error('This sensor is already assigned to another athlete.');
      this.disconnect(athleteId,false);
      this.cancelled.delete(athleteId);
      this.options.state({athleteId,state:'connecting'});
      const entry: Entry = {device,sequence:0,lastSent:-Infinity,stopped:false,listener:()=>{},disconnected:()=>{}};
      this.entries.set(athleteId,entry);
      entry.disconnected=()=>{this.disconnect(athleteId);};
      device.addEventListener('gattserverdisconnected',entry.disconnected);
      const sourceId=crypto.randomUUID();
      entry.lease=await this.options.authorize(athleteId,sourceId);
      if (!this.current(athleteId,entry)) {void this.options.release(athleteId,entry.lease).catch(()=>{});return;}
      if (!device.gatt) throw Error('This device does not expose a compatible GATT server.');
      const server=await device.gatt.connect();
      if (!this.current(athleteId,entry)) {device.gatt.disconnect();return;}
      const service=await server.getPrimaryService(0x180d);
      entry.characteristic=await service.getCharacteristic(0x2a37);
      if (!this.current(athleteId,entry)) return;
      entry.listener=()=>{void this.sample(athleteId,entry);};
      entry.characteristic.addEventListener('characteristicvaluechanged',entry.listener);
      await entry.characteristic.startNotifications();
      if (!this.current(athleteId,entry)) {void entry.characteristic.stopNotifications().catch(()=>{});return;}
      this.options.state({athleteId,state:'connected'});
    } catch {
      this.disconnect(athleteId);
      if (!this.disposed) this.options.state({athleteId,state:'error',message:'Sensor connection did not complete. Check consent, browser support and sensor broadcasting, then retry.'});
    } finally {this.pending.delete(athleteId);this.cancelled.delete(athleteId);if(ownsChooser)this.choosing=false;}
  }
  private current(id: string, entry: Entry) {return !this.disposed && !entry.stopped && this.entries.get(id)===entry;}
  private async sample(id: string, entry: Entry) {
    if (!this.current(id,entry) || !entry.characteristic?.value || !entry.lease) return;
    const sample=parseHeartRate(entry.characteristic.value), now=(this.options.now??Date.now)();
    if (!sample || Math.floor(now/1000)<=Math.floor(entry.lastSent/1000)) return;
    entry.lastSent=now;
    try {await this.options.publish(id,entry.lease,{bpm:sample.bpm,sequence:++entry.sequence,receivedAt:new Date(now).toISOString()});}
    catch(error) {if(!this.current(id,entry))return;if(error instanceof Error&&'status' in error&&error.status===429)return;this.disconnect(id);if(!this.disposed)this.options.state({athleteId:id,state:'error',message:'Sharing could not be confirmed. Recheck consent and reconnect.'});}
  }
  disconnect(id: string, notifyPending=true) {
    if(this.pending.has(id))this.cancelled.add(id);
    const entry=this.entries.get(id); if(!entry){if(notifyPending&&this.pending.has(id))this.options.state({athleteId:id,state:'disconnected'});return;}
    entry.stopped=true;this.entries.delete(id);
    entry.device.removeEventListener('gattserverdisconnected',entry.disconnected);
    entry.characteristic?.removeEventListener('characteristicvaluechanged',entry.listener);
    if(entry.characteristic)void entry.characteristic.stopNotifications().catch(()=>{});
    if(entry.device.gatt?.connected)entry.device.gatt.disconnect();
    if(entry.lease)void this.options.release(id,entry.lease).catch(()=>{});
    this.options.state({athleteId:id,state:'disconnected'});
  }
  retain(athleteIds: Set<string>) {for(const id of this.pending)if(!athleteIds.has(id))this.disconnect(id);for(const id of this.entries.keys())if(!athleteIds.has(id))this.disconnect(id);}
  dispose() {this.disposed=true;for(const id of this.pending)this.cancelled.add(id);for(const id of this.entries.keys())this.disconnect(id);}
}
