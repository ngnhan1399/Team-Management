"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export interface AuthCollaborator {
  id?: number;
  name?: string;
  penName?: string;
  avatar?: string | null;
  [key: string]: unknown;
}

export interface AuthUser {
  id: number;
  email: string;
  role: "admin" | "ctv";
  mustChangePassword: boolean;
  collaboratorId: number | null;
  collaborator?: AuthCollaborator;
}

type AuthLoginResult =
  | { success: true; user: AuthUser }
  | { success: false; error: string };

const AuthContext = createContext<{
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<AuthLoginResult>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}>({
  user: null,
  loading: true,
  login: async () => ({ success: false, error: "Auth context not initialized" }),
  logout: async () => { },
  refreshUser: async () => { },
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me", { cache: "no-store" });
      const data = await res.json();
      if (data.success) {
        setUser(data.user);
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refreshUser(); }, [refreshUser]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (data.success) {
      await refreshUser();
    }
    return data as AuthLoginResult;
  }, [refreshUser]);

  const logout = useCallback(async () => {
    await fetch("/api/auth/me", { method: "DELETE", cache: "no-store" });
    setUser(null);
  }, []);

  const contextValue = useMemo(() => ({
    user,
    loading,
    login,
    logout,
    refreshUser,
  }), [user, loading, login, logout, refreshUser]);

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
