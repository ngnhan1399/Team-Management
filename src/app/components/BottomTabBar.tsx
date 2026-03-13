"use client";

import React from "react";
import type { Page } from "./types";

interface BottomTabBarProps {
  currentPage: Page;
  onNavigate: (page: Page) => void;
  unreadCount?: number;
}

export default function BottomTabBar({ currentPage, onNavigate, unreadCount = 0 }: BottomTabBarProps) {
  const tabs = [
    { id: "dashboard", label: "Tổng quan", icon: "dashboard" },
    { id: "articles", label: "Bài viết", icon: "description" },
    { id: "tasks", label: "Lịch việc", icon: "calendar_month" },
    { id: "royalty", label: "Nhuận bút", icon: "payments" },
    { id: "notifications", label: "Thông báo", icon: "notifications", badge: unreadCount },
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-[2000] lg:hidden">
      <div className="mx-4 mb-4 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl border border-white/20 shadow-[0_8px_32px_rgba(0,0,0,0.12)] rounded-full px-2 py-2 flex items-center justify-around">
        {tabs.map((tab) => {
          const isActive = currentPage === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => onNavigate(tab.id as Page)}
              className={`relative flex flex-col items-center justify-center py-1 px-3 min-w-[64px] transition-all duration-300 ${
                isActive ? "text-blue-600 scale-110" : "text-slate-400"
              }`}
            >
              <div className="relative">
                <span className={`material-symbols-outlined text-[24px] ${isActive ? "filled" : ""}`} style={{ fontVariationSettings: isActive ? "'FILL' 1" : "" }}>
                  {tab.icon}
                </span>
                {tab.badge !== undefined && tab.badge > 0 && (
                  <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[9px] font-bold min-w-[15px] h-[15px] rounded-full flex items-center justify-center px-1 border border-white">
                    {tab.badge > 99 ? "99+" : tab.badge}
                  </span>
                )}
              </div>
              <span className="text-[9px] font-bold uppercase tracking-tight mt-0.5">{tab.label}</span>
              {isActive && (
                <div className="absolute -bottom-1 w-1.5 h-1.5 bg-blue-600 rounded-full" />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
