"use client";

import React from "react";
import { useAuth } from "./auth-context";
import AdminSetupPage from "./AdminSetupPage";
import ChangePasswordPage from "./ChangePasswordPage";
import LoginPage from "./LoginPage";
import MainApp from "./MainApp";

export default function AppRouter() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100vh",
          fontSize: 18,
        }}
      >
        Đang tải...
      </div>
    );
  }

  if (!user) {
    return <LoginPage onLogin={async () => {}} />;
  }

  if (user.mustChangePassword) {
    return <ChangePasswordPage />;
  }

  if (user.role === "admin" && user.adminSetup?.required) {
    return <AdminSetupPage />;
  }

  return <MainApp />;
}
