import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { createAuthStorage } from "./auth-storage";

export const secureAuthStorage = createAuthStorage({
  getItem: (key) => SecureStore.getItemAsync(key),
  setItem: (key, value) => SecureStore.setItemAsync(key, value),
  removeItem: (key) => SecureStore.deleteItemAsync(key),
}, AsyncStorage, () => {
  // Never include the key, value, or native error in this diagnostic.
  console.warn("[AUTH] Secure session migration or legacy cleanup needs retry.");
});
