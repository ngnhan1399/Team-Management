"use client";

import React, { useEffect, useState } from "react";
import { useIsMobile } from "./useMediaQuery";

interface BottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

export default function BottomSheet({
  isOpen,
  onClose,
  title,
  children,
  footer,
}: BottomSheetProps) {
  const isMobile = useIsMobile();
  const [isRendered, setIsRendered] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setIsRendered(true);
      if (typeof document !== "undefined") {
        document.body.style.overflow = "hidden";
      }
    } else {
      const timer = setTimeout(() => {
        setIsRendered(false);
        if (typeof document !== "undefined") {
          document.body.style.overflow = "";
        }
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  if (!isRendered && !isOpen) return null;

  // Pattern for Tablet/Desktop: Regular Modal
  if (!isMobile) {
    return (
      <div className={`modal-overlay ${isOpen ? "active" : ""}`} onClick={onClose} style={{ pointerEvents: "auto" }}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <div className="modal-header">
            <h3 className="modal-title">{title}</h3>
            <button className="modal-close" onClick={onClose}>
              <span className="material-symbols-outlined">close</span>
            </button>
          </div>
          <div className="modal-body custom-scrollbar-y" style={{ maxHeight: "calc(90vh - 140px)", overflowY: "auto" }}>
            {children}
          </div>
          {footer && <div className="modal-footer">{footer}</div>}
        </div>
      </div>
    );
  }

  // Pattern for Mobile: Bottom Sheet
  return (
    <div 
      className={`fixed inset-0 z-[4000] transition-opacity duration-300 ${isOpen ? "opacity-100" : "opacity-0 pointer-events-none"}`}
      style={{ backgroundColor: "rgba(15, 23, 42, 0.4)", backdropFilter: "blur(8px)" }}
      onClick={onClose}
    >
      <div 
        className={`fixed bottom-0 left-0 right-0 bg-white dark:bg-slate-900 rounded-t-[32px] overflow-hidden transition-transform duration-300 ease-apple ${isOpen ? "translate-y-0" : "translate-y-full"}`}
        onClick={(e) => e.stopPropagation()}
        style={{ maxHeight: "92dvh", display: "flex", flexDirection: "column" }}
      >
        <div className="flex flex-col items-center pt-3 pb-2 cursor-grab active:cursor-grabbing">
          <div className="w-12 h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full mb-4" />
          {title && <h3 className="text-lg font-bold text-slate-900 dark:text-white px-6 w-full">{title}</h3>}
        </div>
        
        <div className="flex-1 overflow-y-auto px-6 pb-10 custom-scrollbar">
          {children}
        </div>
        
        {footer && (
          <div className="p-6 border-t border-slate-100 dark:border-slate-800 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
