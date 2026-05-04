import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { resolveApiBaseUrl } from '@/utils/apiUrl';
import { queryClient } from '@/lib/queryClient';

const TOKEN_KEY = '@auth_token';
const REFRESH_TOKEN_KEY = '@refresh_token';

// Must stay in sync with DEMO_TOKEN in artifacts/api-server/src/lib/constants.ts.
const DEMO_TOKEN = 'demo-token';

const BASE_URL = resolveApiBaseUrl();

// ── Module-level token store (synchronous access for api helpers) ──────────────

let _token: string | null = null;
let _refreshToken: string | null = null;

export function getAuthToken(): string | null {
  return _token;
}

async function persistTokens(access: string | null, refresh: string | null) {
  _token = access;
  _refreshToken = refresh;
  if (access) {
    await AsyncStorage.setItem(TOKEN_KEY, access);
  } else {
    await AsyncStorage.removeItem(TOKEN_KEY);
  }
  if (refresh) {
    await AsyncStorage.setItem(REFRESH_TOKEN_KEY, refresh);
  } else {
    await AsyncStorage.removeItem(REFRESH_TOKEN_KEY);
  }
}

// ── Token refresh ──────────────────────────────────────────────────────────────

/**
 * Attempts to refresh the access token using the stored refresh token.
 * Returns true if successful. Called by api helpers on 401.
 */
export async function tryRefreshToken(): Promise<boolean> {
  if (!_refreshToken || _refreshToken === DEMO_TOKEN) return false;
  try {
    const res = await fetch(`${BASE_URL}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: _refreshToken }),
    });
    if (!res.ok) return false;
    const data = await res.json() as { accessToken: string; refreshToken: string };
    _token = data.accessToken;
    _refreshToken = data.refreshToken;
    await AsyncStorage.setItem(TOKEN_KEY, data.accessToken);
    await AsyncStorage.setItem(REFRESH_TOKEN_KEY, data.refreshToken);
    return true;
  } catch {
    return false;
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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      AsyncStorage.getItem(TOKEN_KEY),
      AsyncStorage.getItem(REFRESH_TOKEN_KEY),
    ]).then(([storedAccess, storedRefresh]) => {
      if (storedAccess) {
        _token = storedAccess;
        setToken(storedAccess);
      }
      if (storedRefresh) {
        _refreshToken = storedRefresh;
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
    const data = await res.json() as { accessToken: string; refreshToken?: string };
    await persistTokens(data.accessToken, data.refreshToken ?? null);
    setToken(data.accessToken);
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
    const signInRes = await fetch(`${BASE_URL}/api/auth/signin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!signInRes.ok) throw new Error('Account created but sign-in failed. Please sign in manually.');
    const data = await signInRes.json() as { accessToken: string; refreshToken?: string };
    await persistTokens(data.accessToken, data.refreshToken ?? null);
    setToken(data.accessToken);
  }, []);

  const tryDemo = useCallback(async () => {
    await persistTokens(DEMO_TOKEN, null);
    setToken(DEMO_TOKEN);
  }, []);

  const signOut = useCallback(async () => {
    if (_token && _token !== DEMO_TOKEN) {
      fetch(`${BASE_URL}/api/auth/signout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${_token}` },
      }).catch(() => { /* ignore */ });
    }
    // Clear all cached query data so the next user starts fresh
    queryClient.clear();
    await persistTokens(null, null);
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
