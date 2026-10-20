import { Redirect } from "expo-router";
import { useAuth } from "../src/auth";

export default function Index() {
  const { user, recoveryRequired } = useAuth();
  return <Redirect href={!user ? "/(auth)/sign-in" : recoveryRequired ? "/recover" : "/(tabs)/sessions"} />;
}
