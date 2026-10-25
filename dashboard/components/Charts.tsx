"use client";
import { ReactNode, useState } from "react";
import { useTip } from "./Tip";
import { num, pct } from "@/lib/format";

export type TableSpec = { head: string[]; rows: (string | number)[][] };

export function Card({ title, sub, table, children }: { title: string; sub?: string; table?: TableSpec; children: ReactNode }) {
  const [view, setView] = useState<"chart" | "table">("chart");
  return (
    <section className="card">
      <div className="card-h">
        <div><h3>{title}</h3>{sub && <p>{sub}</p>}</div>
        {table && <button className="tgl" onClick={() => setView(view === "chart" ? "table" : "chart")}>{view === "chart" ? "Show table" : "Show chart"}</button>}
      </div>
      {view === "chart" || !table ? children : (
        <div className="scroll">
          <table className="tbl">
            <thead><tr>{table.head.map((h, i) => <th key={h} className={i ? "num" : ""}>{h}</th>)}</tr></thead>
            <tbody>{table.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className={j ? "num" : ""}>{c}</td>)}</tr>)}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export type Item = { key: string; label: string; value: number; color?: string };

/** Horizontal bars, one per category. Percent is of `total` (defaults to the sum). */
export function HBars({ items, total, color, empty = "Nothing to show for this filter.", onPick }: { items: Item[]; total?: number; color?: string; empty?: string; onPick?: (key: string) => void }) {
  const { show, hide } = useTip();
  const sum = total ?? items.reduce((a, b) => a + b.value, 0);
  const max = Math.max(...items.map((i) => i.value), 1);
  if (!items.length || !sum) return <p className="note">{empty}</p>;
  return (
    <div>
      {items.map((i) => (
        <div key={i.key} className="hrow" tabIndex={0} role={onPick ? "button" : undefined} onClick={() => onPick?.(i.key)} onKeyDown={(e) => e.key === "Enter" && onPick?.(i.key)}
          onMouseMove={(e) => show(e, <><b>{i.label}</b><br />{num(i.value)} calls · {pct(i.value, sum)}</>)} onMouseLeave={hide}
          onFocus={(e) => show(e, <><b>{i.label}</b><br />{num(i.value)} calls · {pct(i.value, sum)}</>)} onBlur={hide}>
          <span className="l" title={i.label}>{i.label}</span>
          <span className="t"><span style={{ width: `${(100 * i.value) / max}%`, background: i.color ?? color }} /></span>
          <span className="v">{num(i.value)} · {pct(i.value, sum)}</span>
        </div>
      ))}
    </div>
  );
}

export type Seg = { key: string; label: string; value: number; color: string; hatch?: boolean };

export function Legend({ items }: { items: { label: string; color: string; hatch?: boolean }[] }) {
  return <div className="legend">{items.map((i) => <span key={i.label}><i className={i.hatch ? "hatch" : ""} style={{ background: i.color }} />{i.label}</span>)}</div>;
}

/** One 100% stacked bar with direct labels on wide segments. */
export function StackBar({ segs }: { segs: Seg[] }) {
  const { show, hide } = useTip();
  const sum = segs.reduce((a, b) => a + b.value, 0);
  if (!sum) return <div className="note">No calls</div>;
  return (
    <div className="stack">
      {segs.filter((s) => s.value > 0).map((s) => {
        const share = (100 * s.value) / sum;
        return (
          <div key={s.key} className={s.hatch ? "hatch" : ""} style={{ width: `${share}%`, background: s.color, color: s.hatch ? "var(--ink)" : "#fff" }} tabIndex={0}
            onMouseMove={(e) => show(e, <><b>{s.label}</b><br />{s.value} calls · {pct(s.value, sum)}</>)} onMouseLeave={hide}
            onFocus={(e) => show(e, <><b>{s.label}</b><br />{s.value} calls · {pct(s.value, sum)}</>)} onBlur={hide}>
            {share >= 9 ? `${Math.round(share)}%` : ""}
          </div>
        );
      })}
    </div>
  );
}

/** Vertical bars for ordered buckets (hours, days, score 1-5). */
export function VBars({ items, unit = "calls", color }: { items: { label: string; value: number }[]; unit?: string; color?: string }) {
  const { show, hide } = useTip();
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <div className="vbars">
      {items.map((i) => (
        <div key={i.label} tabIndex={0}
          onMouseMove={(e) => show(e, <><b>{i.label}</b><br />{num(i.value)} {unit}</>)} onMouseLeave={hide}
          onFocus={(e) => show(e, <><b>{i.label}</b><br />{num(i.value)} {unit}</>)} onBlur={hide}>
          {items.length <= 14 && <span className="n">{i.value || ""}</span>}
          <span className="b" style={{ height: `${Math.max((i.value / max) * 100, i.value ? 2 : 0)}%`, background: color }} />
          <em>{i.label}</em>
        </div>
      ))}
    </div>
  );
}

/* ---------- additions for the redesign ---------- */
import Icon, { IconName } from "./Icon";

export function PageHead({ title, sub, children }: { title: string; sub?: string; children?: ReactNode }) {
  return <div className="pagehead"><div><h1>{title}</h1>{sub && <p>{sub}</p>}</div><div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{children}</div></div>;
}

export function Kpi({ icon, label, value, sub, tone = "indigo", tip }: { icon: IconName; label: string; value: string; sub?: string; tone?: "indigo" | "good" | "bad" | "warn" | "teal"; tip?: string }) {
  const { show, hide } = useTip();
  return (
    <div className={`kpi tone-${tone}`}>
      <div className="kpi-top"><span className="kpi-ic"><Icon n={icon} size={16} /></span><span>{label}</span>
        {tip && <button className="info" aria-label={`About ${label}`} onMouseMove={(e) => show(e, tip)} onMouseLeave={hide} onFocus={(e) => show(e, tip)} onBlur={hide}><Icon n="info" size={14} /></button>}
      </div>
      <b>{value}</b>{sub && <small>{sub}</small>}
    </div>
  );
}

export function Badge({ tone, children }: { tone?: "good" | "bad" | "warn" | "acc"; children: ReactNode }) {
  return <span className={`badge ${tone ? `b-${tone}` : ""}`}><i />{children}</span>;
}

export function Donut({ segs, center, sub, onPick }: { segs: Seg[]; center: string; sub?: string; onPick?: (key: string) => void }) {
  const { show, hide } = useTip();
  const sum = segs.reduce((a, b) => a + b.value, 0);
  const R = 42, C = 2 * Math.PI * R;
  let off = 0;
  if (!sum) return <p className="note">No calls to show.</p>;
  return (
    <div className="donut">
      <svg viewBox="0 0 120 120" role="img" aria-label="Distribution">
        <defs><pattern id="hatchp" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="5" height="5" fill="var(--unk)" /><rect width="1.6" height="5" fill="rgba(180,195,215,.6)" /></pattern></defs>
        <g transform="rotate(-90 60 60)">
          {segs.filter((s) => s.value > 0).map((s) => {
            const len = (s.value / sum) * C, el = (
              <circle key={s.key} cx="60" cy="60" r={R} fill="none" stroke={s.hatch ? "url(#hatchp)" : s.color} strokeWidth="14"
                strokeDasharray={`${Math.max(len - 1.5, 0.5)} ${C}`} strokeDashoffset={-off} style={{ cursor: onPick ? "pointer" : "default" }}
                onMouseMove={(e) => show(e, <><b>{s.label}</b><br />{s.value} calls · {pct(s.value, sum)}</>)} onMouseLeave={hide} onClick={() => onPick?.(s.key)} />);
            off += len; return el;
          })}
        </g>
        <text x="60" y="58" textAnchor="middle" style={{ fill: "var(--ink)", font: "650 20px var(--f-head)" }}>{center}</text>
        {sub && <text x="60" y="73" textAnchor="middle" style={{ fill: "var(--faint)", fontSize: 9 }}>{sub}</text>}
      </svg>
      <ul>{segs.map((s) => (
        <li key={s.key}><button disabled={!onPick} onClick={() => onPick?.(s.key)}><i className={s.hatch ? "hatch" : ""} style={{ background: s.color }} /><span>{s.label}</span><span className="v">{s.value} · {pct(s.value, sum)}</span></button></li>
      ))}</ul>
    </div>
  );
}

const niceMax = (m: number) => { const p = 10 ** Math.floor(Math.log10(m)), r = m / p; return (r <= 1 ? 1 : r <= 2 ? 2 : r <= 5 ? 5 : 10) * p; };

export function LineChart({ labels, series, height = 220 }: { labels: string[]; series: { name: string; color: string; values: number[] }[]; height?: number }) {
  const { show, hide } = useTip();
  const [hi, setHi] = useState<number | null>(null);
  const W = 640, H = height, pl = 34, pr = 10, pt = 10, pb = 26, n = labels.length;
  const max = niceMax(Math.max(...series.flatMap((s) => s.values), 1));
  const x = (i: number) => pl + (n <= 1 ? (W - pl - pr) / 2 : (i * (W - pl - pr)) / (n - 1));
  const y = (v: number) => pt + (H - pt - pb) * (1 - v / max);
  const path = (v: number[]) => v.map((val, i) => {
    if (!i) return `M${x(0)},${y(val)}`;
    const mx = (x(i - 1) + x(i)) / 2; return `C${mx},${y(v[i - 1])} ${mx},${y(val)} ${x(i)},${y(val)}`;
  }).join(" ");
  const k = Math.ceil(n / 8);
  const move = (e: React.MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect(), px = ((e.clientX - r.left) / r.width) * W;
    const i = Math.min(n - 1, Math.max(0, Math.round(((px - pl) / (W - pl - pr)) * (n - 1))));
    setHi(i);
    show(e, <><b>{labels[i]}</b>{series.map((s) => <div key={s.name}>{s.name}: {num(s.values[i])}</div>)}</>);
  };
  return (
    <>
      <svg className="lc" viewBox={`0 0 ${W} ${H}`} onMouseMove={move} onMouseLeave={() => { setHi(null); hide(); }} role="img" aria-label="Line chart">
        {[0, 1, 2, 3, 4].map((t) => <g key={t}><line x1={pl} x2={W - pr} y1={y((max * t) / 4)} y2={y((max * t) / 4)} stroke="var(--line)" strokeWidth="1" /><text x={pl - 6} y={y((max * t) / 4) + 3} textAnchor="end">{Math.round((max * t) / 4)}</text></g>)}
        {labels.map((l, i) => i % k === 0 && <text key={l} x={x(i)} y={H - 8} textAnchor="middle">{l}</text>)}
        {hi !== null && <line x1={x(hi)} x2={x(hi)} y1={pt} y2={H - pb} stroke="var(--faint)" strokeDasharray="3 3" />}
        {series.map((s) => <g key={s.name}><path d={path(s.values)} fill="none" stroke={s.color} strokeWidth="2.2" strokeLinecap="round" />
          {n <= 14 && s.values.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r={hi === i ? 4.5 : 2.8} fill={s.color} stroke="var(--surface)" strokeWidth="1.5" />)}</g>)}
      </svg>
      <Legend items={series.map((s) => ({ label: s.name, color: s.color }))} />
    </>
  );
}
