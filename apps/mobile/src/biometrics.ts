import * as LocalAuthentication from "expo-local-authentication";
import Constants, { ExecutionEnvironment } from "expo-constants";
import { Platform } from "react-native";
import type { BiometricAvailability } from "./biometric-lock-model";

export async function biometricAvailability(): Promise<BiometricAvailability> {
  const unavailable = (reason: string): BiometricAvailability => ({ available: false, label: "Biometric Unlock", reason });
  if (Platform.OS !== "ios" && Platform.OS !== "android") return unavailable("Biometric unlock is available in the native app.");
  try {
    const [hardware, enrolled, types, level] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(), LocalAuthentication.isEnrolledAsync(),
      LocalAuthentication.supportedAuthenticationTypesAsync(), LocalAuthentication.getEnrolledLevelAsync(),
    ]);
    const label = Platform.OS === "ios" ? types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)
      ? "Face ID Unlock" : "Touch ID Unlock" : "Biometric Unlock";
    if (!hardware || !types.length) return unavailable("Biometrics are not supported on this device.");
    if (!enrolled) return { available: false, label, reason: "Set up device biometrics in Settings first." };
    if (Platform.OS === "android" && level !== LocalAuthentication.SecurityLevel.BIOMETRIC_STRONG)
      return unavailable("Set up a supported secure fingerprint or face unlock in device Settings.");
    if (Platform.OS === "ios" && types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)
        && Constants.executionEnvironment === ExecutionEnvironment.StoreClient)
      return { available: false, label, reason: "Face ID requires an Arc Track development or installed native build; Expo Go cannot test it." };
    return { available: true, label, reason: null };
  } catch { return unavailable("Biometrics are currently unavailable. You can keep using your password."); }
}

export async function authenticateBiometric() {
  const available = await biometricAvailability();
  if (!available.available) return { success: false, message: available.reason ?? "Biometrics are unavailable." };
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: "Unlock Arc Track", cancelLabel: "Cancel", disableDeviceFallback: true,
    fallbackLabel: "", biometricsSecurityLevel: "strong",
  });
  return result.success ? { success: true } : { success: false, message: "Not unlocked. Retry or sign out to use your password." };
}
