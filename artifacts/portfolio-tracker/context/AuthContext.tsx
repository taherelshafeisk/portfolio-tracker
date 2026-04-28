import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const TOKEN_KEY = '@auth_token';

// ── Module-level token store (so api helpers can access it synchronously) ─────
let _token: string | null = null;

export function getAuthToken(): string | null {
  return _token;
}

async function persistToken(token: string | null) {
  _token = token;
  if (token) {
    await AsyncStorage.setItem(TOKEN_KEY, token);
  } else {
    await AsyncStorage.removeItem(TOKEN_KEY);
  }
}

// ── Context ───────────────────────────────────────────────────────────────────

interface AuthContextValue {
  token: string | null;
  isLoading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  tryDemo: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function resolveBaseUrl(): string {
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  if (domain) {
    return domain.includes('localhost') ? `http://${domain}` : `https://${domain}`;
  }
  if (typeof window !== 'undefined') {
    return `http://${window.location.hostname}:3001`;
  }
  return '';
}

const BASE_URL = resolveBaseUrl();

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Load persisted token on mount
  useEffect(() => {
    AsyncStorage.getItem(TOKEN_KEY).then(stored => {
      if (stored) {
        _token = stored;
        setToken(stored);
      }
      setIsLoading(false);
    });
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const res = await fetch(`${BASE_URL}/api/auth/signin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error((body as any)?.error ?? `Sign-in failed (${res.status})`);
    }
    const data = await res.json() as { access_token: string };
    await persistToken(data.access_token);
    setToken(data.access_token);
  }, []);

  const signUp = useCallback(async (email: string, password: string) => {
    const res = await fetch(`${BASE_URL}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error((body as any)?.error ?? `Sign-up failed (${res.status})`);
    }
    const data = await res.json() as { access_token: string };
    await persistToken(data.access_token);
    setToken(data.access_token);
  }, []);

  const tryDemo = useCallback(async () => {
    await persistToken('demo-token');
    setToken('demo-token');
  }, []);

  const signOut = useCallback(async () => {
    if (_token && _token !== 'demo-token') {
      // Best-effort server-side signout — ignore errors
      fetch(`${BASE_URL}/api/auth/signout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${_token}` },
      }).catch(() => { /* ignore */ });
    }
    await persistToken(null);
    setToken(null);
  }, []);

  return (
    <AuthContext.Provider value={{ token, isLoading, signIn, signUp, tryDemo, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
