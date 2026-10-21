import { Pressable, Text, View } from "react-native";
import { AuthAction, useAuthStyles } from "../auth-ui";
import { useAppearance } from "../appearance";
import { canShowBiometricSignInSetting, canShowBiometricSignIn } from "./feature";

export function BiometricSignInAction({ available = false, busy = false, onPress }: {
  available?: boolean; busy?: boolean; onPress: () => Promise<void>;
}) {
  if (!canShowBiometricSignIn() || !available) return null;
  return <AuthAction label="Sign in with Biometrics" secondary busy={busy} onPress={() => void onPress()} />;
}

export function BiometricSignInSetting({ available = false, serverConfirmed = false, busy = false, onEnable, onRemove }: {
  available?: boolean; serverConfirmed?: boolean; busy?: boolean;
  onEnable: () => Promise<void>; onRemove: () => Promise<void>;
}) {
  const { colors } = useAppearance();
  const authStyles = useAuthStyles();
  if (!canShowBiometricSignInSetting() || !available) return null;
  return <View>
    <Text style={{ color: colors.text, fontWeight: "700" }}>Biometric Sign-In</Text>
    <Text style={{ color: colors.muted }}>Use your device authentication to sign in faster.</Text>
    <Pressable accessibilityRole="button" disabled={busy}
      accessibilityLabel={serverConfirmed ? "Remove Biometric Sign-In" : "Enable Biometric Sign-In"}
      onPress={() => void (serverConfirmed ? onRemove() : onEnable())}>
      <Text style={authStyles.link}>{serverConfirmed ? "Remove Biometric Sign-In" : "Enable Biometric Sign-In"}</Text>
    </Pressable>
  </View>;
}
