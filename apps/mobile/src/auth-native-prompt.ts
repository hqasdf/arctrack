import { AppState } from "react-native";

// Android credential UI can temporarily pause the activity. This narrow scope
// permits only the outstanding native prompt, never background verification.
// AppState cannot distinguish that UI from Home; require foreground on return.
export function createNativeAuthPromptScope(state: {
  foreground(): boolean;
  subscribe(listener: () => void): () => void;
}, resumeTimeoutMs = 1000) {
  let active = false;
  return {
    get active() { return active; },
    async run<T>(prompt: () => Promise<T>): Promise<T> {
      if (active || !state.foreground()) throw Error("Device authentication requires the active app.");
      active = true;
      try {
        const result = await prompt();
        if (!state.foreground()) await new Promise<void>((resolve, reject) => {
          const deadline = Date.now() + resumeTimeoutMs;
          const timer = setTimeout(() => { unsubscribe(); reject(Error("Device authentication did not return to the active app.")); }, resumeTimeoutMs);
          const unsubscribe = state.subscribe(() => {
            if (state.foreground()) {
              clearTimeout(timer); unsubscribe();
              if (Date.now() > deadline) reject(Error("Device authentication did not return to the active app."));
              else resolve();
            }
          });
          // Handle a foreground transition between the initial check/subscription.
          if (state.foreground()) { clearTimeout(timer); unsubscribe(); resolve(); }
        });
        if (!state.foreground()) throw Error("Device authentication requires the active app.");
        return result;
      } finally { active = false; }
    },
  };
}

export const nativeAuthPrompt = createNativeAuthPromptScope({
  foreground: () => AppState.currentState === "active",
  subscribe: listener => {
    const subscription = AppState.addEventListener("change", listener);
    return () => subscription.remove();
  },
});
