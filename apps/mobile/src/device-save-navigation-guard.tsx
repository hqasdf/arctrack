import { useNavigation } from "expo-router";
import { usePreventRemove } from "expo-router/react-navigation";
import { useEffect, useRef } from "react";
import { Alert } from "react-native";

/** Wait for device durability only, never force an online save to navigate Back. */
export function DeviceSaveNavigationGuard({pending,wait,ready}:{pending:boolean;wait:()=>Promise<void>;ready:()=>boolean}) {
  const navigation=useNavigation(),leaving=useRef(false);
  const mounted=useRef(true);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  usePreventRemove(pending,({data})=>{
    if(leaving.current)return;leaving.current=true;
    void wait().then(()=>{
      if(!mounted.current)return;
      if(!ready())throw Error("Device save is not complete.");
      navigation.dispatch(data.action);
    }).catch(()=>{if(mounted.current)Alert.alert("Changes need attention","The latest edit is not yet safely stored on this device. Keep this screen open and retry the device save before leaving.");})
      .finally(()=>{leaving.current=false;});
  });
  return null;
}
