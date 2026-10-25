"use client";
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Call, Data } from "./types";

export type F = { date: string; lang: string; outcome: string; sent: string; issue: string; resolved: string; esc: string; conf: string; instr: string; q: string };
export const EMPTY: F = { date: "all", lang: "all", outcome: "all", sent: "all", issue: "all", resolved: "all", esc: "all", conf: "all", instr: "all", q: "" };
export const confBand = (c: Call) => (c.confidence >= 4 ? "high" : c.confidence === 3 ? "mid" : "low");

type Ctx = {
  data: Data | null; err: boolean; all: Call[]; calls: Call[];
  f: F; setF: (p: Partial<F>) => void; reset: () => void; active: number;
  sel: Call | null; setSel: (c: Call | null) => void;
  goCalls: (p: Partial<F>) => void; toast: (m: string) => void; msg: string | null;
};
const C = createContext<Ctx | null>(null);
export const useStore = () => { const c = useContext(C); if (!c) throw new Error("store"); return c; };

export function StoreProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState(false);
  const [f, setFs] = useState<F>(EMPTY);
  const [sel, setSel] = useState<Call | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => { fetch("/data.json").then((r) => { if (!r.ok) throw 0; return r.json(); }).then(setData).catch(() => setErr(true)); }, []);
  const all = useMemo(() => data?.calls ?? [], [data]);
  const calls = useMemo(() => {
    const q = f.q.trim().toLowerCase();
    return all.filter((c) =>
      (f.date === "all" || c.date_ist === f.date) && (f.lang === "all" || c.language_chosen === f.lang) &&
      (f.outcome === "all" || c.call_outcome === f.outcome) && (f.sent === "all" || c.sentiment_overall === f.sent) &&
      (f.issue === "all" || c.issue_category === f.issue) && (f.resolved === "all" || c.resolved === f.resolved) &&
      (f.esc === "all" || (f.esc === "yes") === c.reached_human_agent) && (f.conf === "all" || confBand(c) === f.conf) &&
      (f.instr === "all" || (f.instr === "no" ? c.instructions_followed === false : c.instructions_followed === true)) &&
      (!q || `${c.call_id} ${c.issue_summary} ${c.feedback_text} ${c.transcript}`.toLowerCase().includes(q)));
  }, [all, f]);
  const setF = useCallback((p: Partial<F>) => setFs((s) => ({ ...s, ...p })), []);
  const reset = useCallback(() => setFs(EMPTY), []);
  const goCalls = useCallback((p: Partial<F>) => { setFs({ ...EMPTY, ...p }); router.push("/calls"); }, [router]);
  const toast = useCallback((m: string) => { setMsg(m); setTimeout(() => setMsg(null), 2000); }, []);
  const active = (Object.keys(EMPTY) as (keyof F)[]).filter((k) => f[k] !== EMPTY[k]).length;
  return <C.Provider value={{ data, err, all, calls, f, setF, reset, active, sel, setSel, goCalls, toast, msg }}>{children}</C.Provider>;
}
