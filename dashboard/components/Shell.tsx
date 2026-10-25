"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ReactNode, useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import { fmtDate, lab } from "@/lib/format";
import Icon, { IconName } from "./Icon";
import { Drawer } from "./Explorer";

const NAV: { href: string; label: string; icon: IconName; crumb: string }[] = [
  { href: "/", label: "Overview", icon: "dashboard", crumb: "Overview" },
  { href: "/calls", label: "Call Explorer", icon: "phone", crumb: "Call Explorer" },
  { href: "/sentiment", label: "Sentiment & Experience", icon: "smile", crumb: "Sentiment & Experience" },
  { href: "/quality", label: "Voice Agent Quality", icon: "bot", crumb: "Voice Agent Quality" },
  { href: "/feedback", label: "Customer Feedback", icon: "message", crumb: "Customer Feedback" },
  { href: "/insights", label: "Insights & Recommendations", icon: "bulb", crumb: "Insights & Recommendations" },
  { href: "/processing", label: "Processing Monitor", icon: "activity", crumb: "Processing Monitor" },
  { href: "/settings", label: "Settings", icon: "settings", crumb: "Settings" },
];
const NO_FILTERS = ["/processing", "/settings"];

function FilterBar() {
  const { all, calls, f, setF, reset, active, data } = useStore();
  const uniq = (g: (c: (typeof all)[number]) => string) => [...new Set(all.map(g))].sort();
  const sel = (key: keyof typeof f, label: string, opts: [string, string][]) => (
    <select aria-label={label} data-on={f[key] !== "all"} value={f[key]} onChange={(e) => setF({ [key]: e.target.value })}>
      <option value="all">{label}: all</option>{opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
  return (
    <div className="fbar" role="group" aria-label="Filters">
      {sel("date", "Date", (data?.meta.dates ?? []).map((d) => [d, fmtDate(d)]))}
      {sel("lang", "Language", uniq((c) => c.language_chosen).map((v) => [v, lab("language", v)]))}
      {sel("issue", "Category", uniq((c) => c.issue_category).map((v) => [v, lab("issue", v)]))}
      {sel("sent", "Sentiment", ["positive", "neutral", "negative", "unknown"].map((v) => [v, lab("sentiment", v)]))}
      {sel("resolved", "Resolution", ["yes", "partial", "no", "unknown"].map((v) => [v, lab("resolved", v)]))}
      {sel("esc", "Human agent", [["yes", "Reached a person"], ["no", "Never reached"]])}
      {sel("outcome", "Outcome", uniq((c) => c.call_outcome).map((v) => [v, lab("outcome", v)]))}
      {sel("instr", "Bot request", [["yes", "Bot did it"], ["no", "Bot did not"]])}
      {sel("conf", "Confidence", [["high", "High (4-5)"], ["mid", "Medium (3)"], ["low", "Low (1-2)"]])}
      {active > 0 && <button className="clear" onClick={reset}>Clear filters</button>}
      <span className="cnt">{calls.length} of {all.length} calls</span>
    </div>
  );
}

export default function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const { data, err, f, setF, sel, setSel, msg } = useStore();
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [theme, setTheme] = useState("dark");

  useEffect(() => {
    try { setCollapsed(localStorage.getItem("collapsed") === "1"); if (localStorage.getItem("theme") === "light") setTheme("light"); } catch {}
  }, []);
  useEffect(() => setOpen(false), [path]);
  const flipTheme = () => {
    const n = theme === "dark" ? "light" : "dark"; setTheme(n);
    if (n === "light") document.documentElement.setAttribute("data-theme", "light"); else document.documentElement.removeAttribute("data-theme");
    try { localStorage.setItem("theme", n); } catch {}
  };
  const toggleCollapse = () => { const n = !collapsed; setCollapsed(n); try { localStorage.setItem("collapsed", n ? "1" : "0"); } catch {} };
  const here = NAV.find((n) => (n.href === "/" ? path === "/" : path.startsWith(n.href)));
  const dates = data?.meta.dates ?? [];
  const ctx = data ? `${data.meta.n_calls} analysed calls · ${dates.length ? `${fmtDate(dates[0])} to ${fmtDate(dates[dates.length - 1])}` : ""} · IST` : "Loading dataset";

  return (
    <div className="app" data-collapsed={collapsed} data-open={open}>
      <nav className="side" aria-label="Main">
        <div className="brand"><span className="logo"><Icon n="sparkles" size={16} /></span><span className="lbl">VoiceInsight AI</span></div>
        {NAV.map((n) => (
          <Link key={n.href} href={n.href} className="nav" aria-current={here?.href === n.href ? "page" : undefined} title={n.label}>
            <Icon n={n.icon} /><span className="lbl">{n.label}</span>
          </Link>
        ))}
        <span className="grow" />
        <button className="collapse" onClick={toggleCollapse} aria-label="Collapse sidebar"><Icon n="left" /><span className="lbl">Collapse</span></button>
      </nav>
      <div className="main">
        <header className="topbar">
          <button className="iconbtn burger" aria-label="Open menu" onClick={() => setOpen(true)}><Icon n="menu" /></button>
          <div className="crumb"><b>{here?.crumb ?? "Call details"}</b><span>{ctx}</span></div>
          <label className="gsearch"><Icon n="search" size={16} />
            <input type="search" placeholder="Search calls, issues, transcripts" aria-label="Search calls" value={f.q}
              onChange={(e) => { setF({ q: e.target.value }); if (path !== "/calls") router.push("/calls"); }} />
          </label>
          <button className="iconbtn" onClick={flipTheme} aria-label="Switch colour theme"><Icon n={theme === "dark" ? "sun" : "moon"} /></button>
        </header>
        <main className="content">
          {err ? <div className="empty"><h2>No data yet</h2><p>Run <code>python src/aggregate.py</code> from the project folder, then refresh this page.</p></div>
            : !data ? <div style={{ display: "grid", gap: 14 }}><div className="skel" style={{ height: 60 }} /><div className="skel" style={{ height: 110 }} /><div className="skel" style={{ height: 300 }} /></div>
            : <>{!NO_FILTERS.includes(path) && !path.startsWith("/calls/") && <FilterBar />}{children}</>}
        </main>
      </div>
      {sel && <Drawer call={sel} onClose={() => setSel(null)} />}
      {msg && <div className="toast" role="status">{msg}</div>}
    </div>
  );
}
