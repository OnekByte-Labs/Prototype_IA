"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { StatusDot } from "@/components/ds";

export type ToastTone = "default" | "ok" | "warn" | "err";

type Toast = { id: number; text: string; tone: ToastTone };

const ToastCtx = createContext<(text: string, tone?: ToastTone) => void>(() => {});

/** Every operator action gets a receipt. No silent successes. */
export const useToast = () => useContext(ToastCtx);

const DOT: Record<ToastTone, string> = { default: "idle", ok: "ok", warn: "warn", err: "crit" };

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(0);
  const lastToastRef = useRef<{ text: string; time: number }>({ text: "", time: 0 });

  const push = useCallback((text: string, tone: ToastTone = "default") => {
    const now = Date.now();
    // Prevent duplicate notification popups within 1200ms
    if (lastToastRef.current.text === text && now - lastToastRef.current.time < 1200) {
      return;
    }
    lastToastRef.current = { text, time: now };

    const id = ++next.current;
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3000);
  }, []);

  const value = useMemo(() => push, [push]);

  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        data-testid="toasts"
        className="fixed bottom-4 right-4 z-[200] flex flex-col gap-2 items-end pointer-events-none"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            data-testid="toast"
            className="animate-toast bg-raised border border-line rounded-lg shadow-pop pl-3 pr-4 py-2.5 text-ui text-ink flex items-center gap-2.5 max-w-sm"
          >
            <StatusDot tone={DOT[t.tone]} />
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
