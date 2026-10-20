import type { User } from "@supabase/supabase-js";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { configError, mobileAuthentication, sessionAuthority, supabase } from "./supabase";
import { invalidatePasskeyOperations } from "./passkeys/lifecycle";
import { RECOVERY_STORAGE_KEY, isMissingOrInvalidSession, parseRecoveryContext, recoveryBlocksApp, serializeRecoveryContext, type RecoveryContext } from "./auth-flow";
import { authEvent, beginIdentityCheck, beginPasswordSignIn, finishIdentityCheck, initialAuthState, passwordSignInSucceeded } from "./auth-state";

type AuthState = {
  user: User | null;
  loading: boolean;
  configError: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  retry: () => void;
  recovery: RecoveryContext | null;
  recoveryRequired: boolean;
  setRecovery: (context: RecoveryContext | null) => Promise<void>;
  authError: boolean;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState(() => configError ? { status: "unauthenticated" as const, user: null as User | null, generation: 0 } : initialAuthState<User>());
  const generation = useRef(0);
  const checkingIdentity = useRef(false);
  const passwordSignInPending = useRef(false);
  const recoveryVersion = useRef(0);
  const [recovery, setRecoveryState] = useState<RecoveryContext | null>(null);
  const [recoveryLoaded, setRecoveryLoaded] = useState(false);
  const [recoveryLoadError, setRecoveryLoadError] = useState(false);
  const [, renderAuthority] = useState(0);

  const checkIdentity = useCallback(() => {
    if (!supabase) return;
    const request = ++generation.current;
    checkingIdentity.current = true;
    setAuth((state) => beginIdentityCheck(state, request));
    supabase.auth.getUser().then(({ data, error }) => {
      if (generation.current === request) checkingIdentity.current = false;
      const accepted = sessionAuthority?.allowsUser(data.user) ? data.user : null;
      setAuth((state) => finishIdentityCheck(state, request, accepted,
        !!sessionAuthority?.snapshot().error || !!error && !isMissingOrInvalidSession(error)));
    }).catch(() => {
      if (generation.current === request) checkingIdentity.current = false;
      setAuth((state) => finishIdentityCheck(state, request, null, true));
    });
  }, []);

  const loadRecovery = useCallback(() => {
    const version = recoveryVersion.current;
    setRecoveryLoadError(false);
    AsyncStorage.getItem(RECOVERY_STORAGE_KEY).then((stored) => {
      if (recoveryVersion.current === version) setRecoveryState(parseRecoveryContext(stored));
      setRecoveryLoaded(true);
    }).catch(() => { setRecoveryLoadError(true); setRecoveryLoaded(true); });
  }, []);

  const setRecovery = useCallback(async (context: RecoveryContext | null) => {
    ++recoveryVersion.current;
    if (!context) setRecoveryState(null);
    if (context) await AsyncStorage.setItem(RECOVERY_STORAGE_KEY, serializeRecoveryContext(context));
    else await AsyncStorage.removeItem(RECOVERY_STORAGE_KEY);
    if (context) setRecoveryState(context);
  }, []);

  useEffect(() => {
    loadRecovery();
    if (!supabase) return;
    let active = true;
    let presentation = "";
    const authority = sessionAuthority;
    let presentedAccount = authority?.snapshot().accepted?.accountId ?? null;
    const unsubscribeAuthority = authority?.subscribe(() => {
      if (!active) return;
      const snapshot = authority.snapshot();
      const next = JSON.stringify([snapshot.accepted?.epoch, snapshot.accepted?.mode, snapshot.error?.code, snapshot.retiring, snapshot.ready]);
      if (next === presentation) return;
      presentation = next;
      const changedAccount = presentedAccount !== null && snapshot.accepted?.accountId !== presentedAccount;
      presentedAccount = snapshot.accepted?.accountId ?? null;
      renderAuthority(value => value + 1);
      if (snapshot.error || snapshot.retiring || snapshot.ready && !snapshot.accepted) {
        checkingIdentity.current = false;
        const nextGeneration = ++generation.current;
        setAuth({ status: snapshot.error ? "error" : "unauthenticated", user: null, generation: nextGeneration });
      } else if (changedAccount) {
        checkingIdentity.current = false;
        setAuth({ status: "loading", user: null, generation: ++generation.current });
      }
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (__DEV__) console.debug("[AUTH] event", { event: _event, user: !!session?.user });
      if (!active || _event === "INITIAL_SESSION") return;
      if (session?.user && !sessionAuthority?.allowsSession(session)) return;
      if (_event === "SIGNED_OUT" && sessionAuthority?.snapshot().accepted) return;
      invalidatePasskeyOperations();
      if (_event === "SIGNED_OUT") {
        // Clear the in-memory gate in the same event as the user. Storage cleanup
        // must not determine which screen becomes available after sign-out.
        void setRecovery(null).catch(() => { if (__DEV__) console.warn("[AUTH] recovery storage cleanup failed"); });
      }
      // signInWithPassword has an explicit result; its generic SIGNED_IN event
      // must not race recovery cleanup or a pending startup identity check.
      if (passwordSignInPending.current && session?.user) return;
      if (session?.user && checkingIdentity.current) {
        // A restored local session can emit SIGNED_IN. Verify it before opening routes.
        checkIdentity();
        return;
      }
      checkingIdentity.current = false;
      const next = ++generation.current;
      setAuth((state) => authEvent(state, _event, session?.user ?? null, next));
    });
    checkIdentity();
    return () => { active = false; unsubscribeAuthority?.(); invalidatePasskeyOperations(); listener.subscription.unsubscribe(); };
  }, [checkIdentity, loadRecovery, setRecovery]);

  async function signIn(email: string, password: string) {
    if (!supabase || !mobileAuthentication) throw new Error("Supabase is not configured.");
    invalidatePasskeyOperations();
    passwordSignInPending.current = true;
    checkingIdentity.current = false;
    const started = ++generation.current;
    setAuth((state) => beginPasswordSignIn(state, started));
    try {
      const { data, error } = await mobileAuthentication.signInWithPassword({ email, password });
      if (error || !data.user || !data.session) throw error ?? new Error("Sign-in did not return a session.");
      if (!sessionAuthority?.allowsSession(data.session)) throw new Error("This sign-in attempt is no longer current.");
      const signedInUser = data.user;
      if (__DEV__) console.debug("[AUTH] signIn success", { user: !!data.user, session: !!data.session });
      // This known password sign-in supersedes abandoned recovery intent.
      // Clear memory synchronously, but do not delay authenticated state for I/O.
      void setRecovery(null).catch(() => { if (__DEV__) console.warn("[AUTH] recovery storage cleanup failed"); });
      checkingIdentity.current = false;
      const next = ++generation.current;
      setAuth((state) => passwordSignInSucceeded(state, signedInUser, next));
    } finally { passwordSignInPending.current = false; }
  }

  async function signOut() {
    if (!supabase || !mobileAuthentication) return;
    invalidatePasskeyOperations();
    if (__DEV__) console.debug("[AUTH] signOut pressed");
    await mobileAuthentication.signOut();
    if (sessionAuthority?.snapshot().accepted) return;
    const cleanup = setRecovery(null);
    if (__DEV__) console.debug("[AUTH] recovery state cleared");
    const next = ++generation.current;
    setAuth((state) => authEvent(state, "SIGNED_OUT", null, next));
    await cleanup;
  }

  const user = auth.status === "authenticated" ? auth.user : null;
  useEffect(() => {
    if (!user?.id) return;
    // Remove only this verified account's obsolete app-lock flag. Session keys
    // and all other preferences remain untouched; cleanup never gates sign-in.
    void SecureStore.deleteItemAsync(`arc-track.biometric-unlock.v1.${user.id}`).catch(() => {
      if (__DEV__) console.warn("[AUTH] Legacy app-lock preference cleanup needs retry.");
    });
  }, [user?.id]);
  const loading = auth.status === "loading" || !recoveryLoaded;
  const authError = auth.status === "error" || recoveryLoadError;
  const acceptedAuthority = sessionAuthority?.snapshot();
  const recoveryRequired = !!user && (acceptedAuthority?.ready
    ? acceptedAuthority.accepted?.mode === "recovery" : recoveryBlocksApp(user, recovery));
  // Recovery authority survives independently of editable UI progress metadata.
  const shownRecovery: RecoveryContext | null = recoveryRequired && user && !recoveryBlocksApp(user, recovery)
    ? { active: true, stage: "password", userId: user.id, email: user.email ?? recovery?.email ?? "" }
    : recovery;
  useEffect(() => {
    if (__DEV__) console.debug("[AUTH] provider", { user: !!user, loading, authError, recoveryRequired, generation: auth.generation });
  }, [user, loading, authError, recoveryRequired, auth.generation]);
  const retry = () => {
    if (recoveryLoadError) { setRecoveryLoaded(false); loadRecovery(); }
    if (auth.status === "error") {
      if (sessionAuthority?.snapshot().error) void sessionAuthority.retry().then(checkIdentity).catch(() => {});
      else checkIdentity();
    }
  };
  return <AuthContext.Provider value={{ user, loading, configError, signIn, signOut, retry, recovery: shownRecovery, recoveryRequired, setRecovery, authError }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("AuthProvider is missing.");
  return value;
}
