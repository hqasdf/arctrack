import { Platform, TextInput, type TextInputProps } from "react-native";

/** A single input accepts manual typing, paste and a complete native suggestion. */
export function OtpInput(props: TextInputProps) {
  return <TextInput {...props} keyboardType="number-pad" maxLength={6} autoCorrect={false} autoCapitalize="none"
    {...(Platform.OS === "ios" ? { textContentType: "oneTimeCode" as const } : { autoComplete: "one-time-code" as const, importantForAutofill: "yes" as const })} />;
}
