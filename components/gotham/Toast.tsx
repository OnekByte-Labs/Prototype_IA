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

export type ToastTone = "default" | "ok" | "warn" | "err";

type Toast = { id: number; text: string; tone: ToastTone };

const ToastCtx = createContext<(text: string, tone?: ToastTone) => void>(() => {});

/** Every operator action gets a receipt. No silent successes. */
export const useToast = () => useContext(ToastCtx);

const TONE: Record<ToastTone, string> = {
  default: "border-g-border-strong text-g-text",
  ok: "border-g-green/50 text-g-green",
  warn: "border-g-amber/50 text-g-amber",
  err: "border-g-red/50 text-g-red",
};

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
        className="fixed bottom-3 right-3 z-[100] flex flex-col gap-1.5 items-end pointer-events-none"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            data-testid="toast"
            className={`animate-g-toast bg-g-raised border rounded-[2px] px-2.5 py-1.5 text-data font-data ${TONE[t.tone]}`}
          >
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
