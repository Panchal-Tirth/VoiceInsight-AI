"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Call } from "@/lib/types";
import { fmtDate, fmtDur, lab } from "@/lib/format";
import { phases } from "@/lib/derive";
import { useStore } from "@/lib/store";
import { Badge } from "./Charts";
import Icon from "./Icon";

type Key = "call_id" | "when" | "duration_sec" | "hold_sec" | "bot_guidance_score" | "sentiment_overall" | "call_outcome" | "language_chosen" | "issue_category" | "resolved";

export function Pill({ s }: { s: string }) {
  return <Badge tone={s === "positive" ? "good" : s === "negative" ? "bad" : undefined}>{lab("sentiment", s)}</Badge>;
}
const resTone = (r: string) => (r === "yes" ? "good" : r === "no" ? "bad" : r === "partial" ? "warn" : undefined);

const csvCell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
export function exportCsv(rows: Call[]) {
  const cols: (keyof Call)[] = ["call_id", "date_ist", "time_ist", "duration_sec", "language_chosen", "issue_category", "sentiment_overall", "resolved", "call_outcome", "reached_human_agent", "bot_guidance_score", "confidence", "issue_summary"];
  const body = [cols.join(","), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(","))].join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["﻿" + body], { type: "text/csv;charset=utf-8" }));
  a.download = "calls_filtered.csv"; a.click(); URL.revokeObjectURL(a.href);
}

export default function Explorer() {
  const { calls, all, f, setF, setSel, toast } = useStore();
  const [key, setKey] = useState<Key>("when");
  const [dir, setDir] = useState<1 | -1>(-1);
  const [limit, setLimit] = useState(20);
  useEffect(() => setLimit(20), [calls]);
  const rows = useMemo(() => [...calls].sort((a, b) => {
    const g = (c: Call) => (key === "when" ? `${c.date_ist} ${c.time_ist}` : c[key]);
    const x = g(a), y = g(b);
    if (x === null || x === undefined) return 1;
    if (y === null || y === undefined) return -1;
    return (x < y ? -1 : x > y ? 1 : 0) * dir;
  }), [calls, key, dir]);
  const head = (k: Key, label: string, cls = "") => (
    <th className={cls} aria-sort={key === k ? (dir === 1 ? "ascending" : "descending") : "none"}>
      <button onClick={() => (key === k ? setDir((dir * -1) as 1 | -1) : (setKey(k), setDir(-1)))}>{label}{key === k ? (dir === 1 ? " ▲" : " ▼") : ""}</button>
    </th>
  );
  return (
    <div className="card">
      <div className="card-h">
        <div><h3>{rows.length} matching calls</h3><p>{rows.length === all.length ? "All analysed calls" : `Filtered from ${all.length}`}. Click a row for a quick look, or open the full analysis.</p></div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input className="search" type="search" placeholder="Search id, summary or transcript" value={f.q} aria-label="Search calls" onChange={(e) => setF({ q: e.target.value })} />
          <button className="btn" onClick={() => { exportCsv(rows); toast(`Exported ${rows.length} calls`); }} disabled={!rows.length}><Icon n="download" size={15} />Export CSV</button>
        </div>
      </div>
      <div className="scroll">
        <table className="xtbl">
          <thead><tr>{head("call_id", "Call ID")}{head("when", "Date and time (IST)", "hide-sm")}{head("duration_sec", "Duration")}{head("language_chosen", "Language", "hide-sm")}{head("issue_category", "Category", "hide-sm")}{head("sentiment_overall", "Sentiment")}{head("resolved", "Resolution")}<th className="hide-sm">Human agent</th><th className="hide-sm">Status</th><th><span className="sr-only" style={{ position: "absolute", left: -9999 }}>Details</span></th></tr></thead>
          <tbody>
            {rows.slice(0, limit).map((c) => (
              <tr key={c.call_id} tabIndex={0} onClick={() => setSel(c)} onKeyDown={(e) => e.key === "Enter" && setSel(c)}>
                <td className="mono">{c.call_id}</td><td className="hide-sm mono">{fmtDate(c.date_ist)}, {c.time_ist}</td><td className="mono">{fmtDur(c.duration_sec)}</td>
                <td className="hide-sm">{lab("language", c.language_chosen)}</td><td className="hide-sm">{lab("issue", c.issue_category)}</td>
                <td><Pill s={c.sentiment_overall} /></td><td><Badge tone={resTone(c.resolved)}>{lab("resolved", c.resolved)}</Badge></td>
                <td className="hide-sm">{c.reached_human_agent ? <Badge tone="acc">Reached</Badge> : <Badge>No</Badge>}</td>
                <td className="hide-sm"><Badge tone="good">Analysed</Badge></td>
                <td><Link href={`/calls/${c.call_id}`} onClick={(e) => e.stopPropagation()} className="lnk">Details<Icon n="arrow" size={13} /></Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > limit && <p style={{ textAlign: "center", margin: "14px 0 0" }}><button className="btn" onClick={() => setLimit(limit + 25)}>Show 25 more</button></p>}
      {!rows.length && <div className="empty"><b>No calls match these filters.</b><p>Clear a filter or change the search to see calls again.</p></div>}
    </div>
  );
}

export function Drawer({ call, onClose }: { call: Call; onClose: () => void }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  const p = phases(call);
  const yn = (v: boolean | null) => (v === null ? "Not applicable" : v ? "Yes" : "No");
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label={`Call ${call.call_id}`}>
        <div className="card-h">
          <div><h3 style={{ fontSize: 20 }}>Call {call.call_id}</h3><p>{fmtDate(call.date_ist)}, {call.time_ist} IST · {fmtDur(call.duration_sec)}</p></div>
          <div style={{ display: "flex", gap: 8 }}><Link href={`/calls/${call.call_id}`} className="btn primary" onClick={onClose}>Full analysis</Link><button className="tgl" onClick={onClose}>Close</button></div>
        </div>
        <p style={{ margin: "0 0 10px" }}>{call.issue_summary}</p>
        <div className="rbar" style={{ height: 12 }}>
          {p.bot > 0 && <i className="ph-bot" style={{ flex: p.bot }} />}{p.hold > 0 && <i className="ph-hold" style={{ flex: p.hold }} />}{p.conv > 0 && <i className="ph-conv" style={{ flex: p.conv }} />}
        </div>
        <p className="note" style={{ marginTop: 8 }}>Bot {fmtDur(p.bot)} · Queue {fmtDur(p.hold)} · After {fmtDur(p.conv)}</p>
        <div className="dgrid">
          <div>Customer sentiment<b><Pill s={call.sentiment_overall} /></b></div>
          <div>Start → end<b>{lab("sentiment", call.sentiment_start)} → {lab("sentiment", call.sentiment_end)}</b></div>
          <div>Outcome<b>{lab("outcome", call.call_outcome)}</b></div>
          <div>Issue<b>{lab("issue", call.issue_category)}</b></div>
          <div>Language chosen<b>{lab("language", call.language_chosen)}</b></div>
          <div>Language request honoured<b>{yn(call.language_request_honored)}</b></div>
          <div>Bot did what was asked<b>{yn(call.instructions_followed)}</b></div>
          <div>Bot guidance (1–5)<b>{call.bot_guidance_score ?? "–"}</b></div>
          <div>Attitude to the bot<b>{lab("attitude", call.customer_bot_attitude)}</b></div>
          <div>Transcript quality<b>{lab("quality", call.transcript_quality)}</b></div>
        </div>
        {call.bot_issues.length > 0 && <p><b>Bot problems:</b> {call.bot_issues.map((b) => lab("botIssue", b)).join(", ")}</p>}
        {call.missed_instructions.length > 0 && <div className="quote">Missed: {call.missed_instructions.join("; ")}</div>}
        {call.evidence_sentiment && <div className="quote">Sentiment evidence: {call.evidence_sentiment}</div>}
        {call.evidence_bot && <div className="quote">Bot evidence: {call.evidence_bot}</div>}
        {call.verbal_feedback_given && <div className="quote">Feedback ({lab("feedbackTheme", call.feedback_theme)}): {call.feedback_text}</div>}
        {call.postprocess_changes.length > 0 && <p className="note">Consistency rules adjusted: {call.postprocess_changes.join("; ")}</p>}
        <h3 style={{ margin: "16px 0 8px" }}>Cleaned transcript</h3>
        <div className="tx">{call.transcript || "No transcript."}</div>
        <p className="note" style={{ marginTop: 8 }}>Model confidence {call.confidence}/5 · analysed by {call.analysis_model}</p>
      </aside>
    </>
  );
}
