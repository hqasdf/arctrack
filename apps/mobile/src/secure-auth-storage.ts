import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { createAuthStorage } from "./auth-storage";

export const secureAuthorityStorage = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
};

export const secureAuthStorage = createAuthStorage(secureAuthorityStorage, AsyncStorage, () => {
  // Never include the key, value, or native error in this diagnostic.
  console.warn("[AUTH] Secure session migration or legacy cleanup needs retry.");
});
