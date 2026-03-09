"use client";

import AppRouter from "./components/AppRouter";
import { AuthProvider } from "./components/auth-context";

export default function Home() {
  return (
    <AuthProvider>
      <AppRouter />
    </AuthProvider>
  );
}
