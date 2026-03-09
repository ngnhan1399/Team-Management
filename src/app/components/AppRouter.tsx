"use client";

import React from "react";
import { useAuth } from "./auth-context";
import ChangePasswordPage from "./ChangePasswordPage";
import LoginPage from "./LoginPage";
import MainApp from "./MainApp";

export default function AppRouter() {
  const { user, loading } = useAuth();

  if (loading) {
    return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", fontSize: 18 }}>⏳ Đang tải...</div>;
  }

  if (!user) {
    return <LoginPage onLogin={async () => { /* handled by AuthContext */ }} />;
  }

  if (user.mustChangePassword) {
    return <ChangePasswordPage />;
  }

  return <MainApp />;
}
