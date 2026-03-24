"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export interface AuthCollaborator {
  id?: number;
  name?: string;
  penName?: string;
  role?: "writer" | "reviewer";
  avatar?: string | null;
  [key: string]: unknown;
}

export interface AuthUser {
  id: number;
  email: string;
  role: "admin" | "ctv";
  isLeader: boolean;
  mustChangePassword: boolean;
  showDailyKpiPopup?: boolean;
  collaboratorId: number | null;
  teamId: number | null;
  team?: {
    id: number;
    name: string;
    description?: string | null;
    status?: "active" | "archived";
  } | null;
  collaborator?: AuthCollaborator;
}

type AuthLoginResult =
  | { success: true; user: AuthUser }
  | { success: false; error: string };

type AuthRegisterResult = AuthLoginResult;

const AuthContext = createContext<{
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<AuthLoginResult>;
  register: (email: string, password: string) => Promise<AuthRegisterResult>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}>({
  user: null,
  loading: true,
  login: async () => ({ success: false, error: "Auth context not initialized" }),
  register: async () => ({ success: false, error: "Auth context not initialized" }),
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
    try {
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
    } catch {
      return {
        success: false as const,
        error: "Khong the ket noi den he thong. Vui long thu lai sau.",
      };
    }
  }, [refreshUser]);

  const register = useCallback(async (email: string, password: string) => {
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (data.success) {
        await refreshUser();
      }
      return data as AuthRegisterResult;
    } catch {
      return {
        success: false as const,
        error: "Khong the ket noi den he thong. Vui long thu lai sau.",
      };
    }
  }, [refreshUser]);

  const logout = useCallback(async () => {
    await fetch("/api/auth/me", { method: "DELETE", cache: "no-store" });
    setUser(null);
  }, []);

  const contextValue = useMemo(() => ({
    user,
    loading,
    login,
    register,
    logout,
    refreshUser,
  }), [user, loading, login, register, logout, refreshUser]);

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
