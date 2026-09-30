import { useState } from "react";
import { Pressable, TextInput, View, type TextInputProps } from "react-native";
import Svg, { Path } from "react-native-svg";
import { colors } from "./theme";

export function PasswordField({ style, accessibilityLabel = "Password", ...props }: TextInputProps) {
  const [visible, setVisible] = useState(false);
  return <View style={{ position: "relative" }}>
    <TextInput {...props} accessibilityLabel={accessibilityLabel} secureTextEntry={!visible} style={[style, { paddingRight: 58 }]} />
    <Pressable accessibilityRole="button" accessibilityLabel={`${visible ? "Hide" : "Show"} ${accessibilityLabel.toLowerCase()}`}
      onPress={() => setVisible((current) => !current)} style={{ position: "absolute", right: 2, top: 2, width: 50, height: 50, alignItems: "center", justifyContent: "center" }}>
      <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={colors.text} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
        <Path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6Z"/>
        {visible ? <><Path d="M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z"/></> : <Path d="M3 3l18 18"/>}
      </Svg>
    </Pressable>
  </View>;
}
