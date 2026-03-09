"use client";

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type SelectOption = { value: string; label: string };
type MenuPlacement = "top" | "bottom";
type MenuMode = "portal-auto" | "portal-bottom";

type MenuPosition = {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
  placement: MenuPlacement;
};

const VIEWPORT_MARGIN = 16;
const MENU_OFFSET = 8;
const DEFAULT_MENU_MAX_HEIGHT = 240;
const MIN_OPEN_SPACE = 180;

export default function CustomSelect({
  value,
  onChange,
  options,
  placeholder = "Chọn",
  menuMode = "portal-auto",
}: {
  value: string;
  onChange: (v: string) => void;
  options: SelectOption[];
  placeholder?: string;
  menuMode?: MenuMode;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (ref.current?.contains(target) || menuRef.current?.contains(target)) {
        return;
      }

      if (ref.current) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [isOpen]);

  useLayoutEffect(() => {
    if (!isOpen || typeof window === "undefined" || !ref.current) {
      return;
    }

    const updateMenuPosition = () => {
      if (!ref.current) return;

      const rect = ref.current.getBoundingClientRect();
      const viewportSpaceAbove = rect.top - VIEWPORT_MARGIN;
      const viewportSpaceBelow = window.innerHeight - rect.bottom - VIEWPORT_MARGIN;

      let shouldOpenUpward = false;
      let availableSpace = viewportSpaceBelow;

      if (menuMode === "portal-auto") {
        const boundaryElement = ref.current.closest(".modal, .glass-card") as HTMLElement | null;
        const boundaryRect = boundaryElement?.getBoundingClientRect();
        const localSpaceAbove = boundaryRect ? rect.top - boundaryRect.top - VIEWPORT_MARGIN : viewportSpaceAbove;
        const localSpaceBelow = boundaryRect ? boundaryRect.bottom - rect.bottom - VIEWPORT_MARGIN : viewportSpaceBelow;
        const spaceAbove = Math.min(viewportSpaceAbove, localSpaceAbove);
        const spaceBelow = Math.min(viewportSpaceBelow, localSpaceBelow);
        shouldOpenUpward = spaceBelow < MIN_OPEN_SPACE && spaceAbove > spaceBelow;
        availableSpace = shouldOpenUpward ? spaceAbove : spaceBelow;
      }

      const maxHeight = Math.max(120, Math.min(DEFAULT_MENU_MAX_HEIGHT, availableSpace - MENU_OFFSET));

      setMenuPosition({
        top: shouldOpenUpward ? rect.top - MENU_OFFSET : rect.bottom + MENU_OFFSET,
        left: Math.max(VIEWPORT_MARGIN, rect.left),
        width: rect.width,
        maxHeight,
        placement: shouldOpenUpward ? "top" : "bottom",
      });
    };

    updateMenuPosition();
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);

    return () => {
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [isOpen, menuMode]);

  const selected = options.find((o) => o.value === value);
  const menuList = (
    <ul
      style={{
        listStyle: "none",
        padding: 8,
        margin: 0,
        maxHeight: menuPosition?.maxHeight || DEFAULT_MENU_MAX_HEIGHT,
        overflowY: "auto",
      }}
      className="custom-scrollbar"
    >
      {options.map((o) => (
        <li
          key={o.value}
          onClick={() => {
            onChange(o.value);
            setIsOpen(false);
          }}
          style={{
            padding: "10px 16px",
            borderRadius: 10,
            cursor: "pointer",
            background: o.value === value ? "var(--accent-blue)" : "transparent",
            color: o.value === value ? "white" : "var(--text-main)",
            fontWeight: o.value === value ? 700 : 500,
            transition: "all 0.15s ease",
            fontSize: 14,
            lineHeight: 1.4,
          }}
          className={o.value !== value ? "hover:bg-slate-50" : ""}
        >
          {o.label}
        </li>
      ))}
    </ul>
  );

  const portalMenu = isOpen && typeof document !== "undefined" && menuPosition ? (
    <div
      ref={menuRef}
      style={{
        position: "fixed",
        top: menuPosition.top,
        left: menuPosition.left,
        width: menuPosition.width,
        maxWidth: `calc(100vw - ${VIEWPORT_MARGIN * 2}px)`,
        background: "rgba(255, 255, 255, 0.98)",
        backdropFilter: "blur(20px)",
        borderRadius: "var(--radius-ios-sm)",
        boxShadow: "0 18px 48px rgba(15, 23, 42, 0.18), 0 0 0 1px var(--glass-border)",
        zIndex: 1200,
        overflow: "hidden",
        animation: "modalFadeIn 0.18s cubic-bezier(0.16, 1, 0.3, 1)",
        transform: menuPosition.placement === "top" ? "translateY(-100%)" : "none",
      }}
    >
      {menuList}
    </div>
  ) : null;

  return (
    <div ref={ref} style={{ position: "relative", width: "100%", display: "flex", flexDirection: "column" }}>
      <div
        onClick={() => setIsOpen(!isOpen)}
        className="form-select"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          cursor: "pointer",
          background: isOpen ? "rgba(255, 255, 255, 0.95)" : "rgba(255, 255, 255, 0.7)",
          border: isOpen ? "1px solid rgba(37, 99, 235, 0.32)" : "1px solid var(--glass-border)",
          height: 44,
          padding: "0 16px",
          borderRadius: 12,
          boxShadow: isOpen ? "0 0 0 4px rgba(37, 99, 235, 0.08)" : "none",
          transition: "background 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease",
        }}
      >
        <span style={{ color: selected ? "var(--text-main)" : "var(--text-muted)", fontSize: 14 }}>
          {selected ? selected.label : placeholder}
        </span>
        <span
          className="material-symbols-outlined"
          style={{ fontSize: 20, transition: "transform 0.2s", transform: isOpen ? "rotate(180deg)" : "none", color: "var(--text-muted)" }}
        >
          expand_more
        </span>
      </div>
      {portalMenu ? createPortal(portalMenu, document.body) : null}
    </div>
  );
}
