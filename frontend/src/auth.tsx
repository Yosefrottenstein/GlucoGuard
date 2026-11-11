import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from "react";

import { queryClient } from "./query-client";
import { storage } from "./utils/storage";

const TOKEN_KEY = "auth_token";
const USER_KEY = "auth_username";

// In-memory copy so every API call can add the header without awaiting storage.
let token: string | null = null;
const listeners = new Set<() => void>();
export const getToken = () => token;
export function authHeaders(): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}
export async function clearSession() {
  token = null;
  await storage.secureRemove(TOKEN_KEY);
  await storage.removeItem(USER_KEY);
  queryClient.clear();
  listeners.forEach((l) => l());
}

type Auth = {
  ready: boolean;
  signedIn: boolean;
  username: string;
  needsEmail: boolean;
  signIn: (t: string, u: string, opts?: { askEmail?: boolean }) => Promise<void>;
  emailDone: () => void;
  signOut: () => Promise<void>;
};
const AuthContext = createContext<Auth>({
  ready: false,
  signedIn: false,
  username: "",
  needsEmail: false,
  signIn: async () => {},
  emailDone: () => {},
  signOut: async () => {},
});
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [username, setUsername] = useState("");
  const [needsEmail, setNeedsEmail] = useState(false);

  useEffect(() => {
    (async () => {
      token = await storage.secureGet(TOKEN_KEY, null);
      setUsername((await storage.getItem(USER_KEY, "")) as string);
      setSignedIn(!!token);
      setReady(true);
    })();
    const onChange = () => setSignedIn(!!token);
    listeners.add(onChange);
    return () => {
      listeners.delete(onChange);
    };
  }, []);

  const signIn = useCallback(async (t: string, u: string, opts?: { askEmail?: boolean }) => {
    token = t;
    await storage.secureSet(TOKEN_KEY, t);
    await storage.setItem(USER_KEY, u);
    setUsername(u);
    setNeedsEmail(!!opts?.askEmail);
    setSignedIn(true);
  }, []);
  const emailDone = useCallback(() => setNeedsEmail(false), []);

  return (
    <AuthContext.Provider value={{ ready, signedIn, username, needsEmail, signIn, emailDone, signOut: clearSession }}>{children}</AuthContext.Provider>
  );
}
