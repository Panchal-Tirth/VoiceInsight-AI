"use client";
import { createContext, ReactNode, useCallback, useContext, useState } from "react";

type T = { x: number; y: number; content: ReactNode } | null;
type Ev = React.MouseEvent | React.FocusEvent;
const Ctx = createContext<{ show: (e: Ev, c: ReactNode) => void; hide: () => void }>({ show() {}, hide() {} });
export const useTip = () => useContext(Ctx);

export function TipProvider({ children }: { children: ReactNode }) {
  const [t, setT] = useState<T>(null);
  const show = useCallback((e: Ev, content: ReactNode) => {
    if ("clientX" in e) setT({ x: e.clientX, y: e.clientY, content });
    else { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setT({ x: r.left + r.width / 2, y: r.bottom, content }); }
  }, []);
  const hide = useCallback(() => setT(null), []);
  const flip = t && typeof window !== "undefined" && t.x > window.innerWidth - 300;
  return (
    <Ctx.Provider value={{ show, hide }}>
      {children}
      {t && (
        <div className="tip" role="tooltip" style={{ left: flip ? t.x - 14 : t.x + 14, top: t.y + 14, transform: flip ? "translateX(-100%)" : undefined }}>
          {t.content}
        </div>
      )}
    </Ctx.Provider>
  );
}
