"use client";
import { useState } from "react";
import { countBy, kpis } from "@/lib/derive";
import { fmtDate, lab, pct } from "@/lib/format";
import { useStore } from "@/lib/store";
import { Badge, Card, HBars, Item, Kpi, PageHead } from "@/components/Charts";
import { Pill } from "@/components/Explorer";
import Link from "next/link";

export default function Feedback() {
  const { calls, setSel } = useStore();
  const [theme, setTheme] = useState("all");
  const k = kpis(calls);
  const fb = calls.filter((c) => c.verbal_feedback_given);
  const themes: Item[] = [...countBy(fb, (c) => c.feedback_theme)].filter(([t]) => t !== "none").map(([key, value]) => ({ key, label: lab("feedbackTheme", key), value })).sort((a, b) => b.value - a.value);
  const att: Item[] = [...countBy(calls, (c) => c.customer_bot_attitude)].map(([key, value]) => ({ key, label: lab("attitude", key), value })).sort((a, b) => b.value - a.value);
  const rows = fb.filter((c) => theme === "all" || c.feedback_theme === theme);
  return (
    <>
      <PageHead title="Customer Feedback" sub="What callers said in their own words, with the call it came from. Spoken feedback only: the keypad rating at the end of a call is not in the audio text." />
      <div className="kpis">
        <Kpi icon="message" label="Gave spoken feedback" value={String(k.verbal)} sub={`${pct(k.verbal, k.n)} of calls`} />
        <Kpi icon="check" tone="teal" label="Reached the rating prompt" value={String(k.survey)} sub={`${pct(k.survey, k.n)} of calls`} tip="Calls that reached the end-of-call happy / unhappy prompt. The key pressed is not recorded in the transcript." />
        <Kpi icon="up" tone="good" label="Praise" value={String(fb.filter((c) => c.feedback_theme === "praise_agent" || c.feedback_theme === "thanks_only").length)} sub="Praise or thanks" />
        <Kpi icon="down" tone="bad" label="Complaints" value={String(fb.filter((c) => c.feedback_theme.startsWith("complaint")).length)} sub="About wait, bot or agent" />
      </div>
      <div className="grid2">
        <Card title="Feedback themes" table={{ head: ["Theme", "Calls"], rows: themes.map((i) => [i.label, i.value]) }}><HBars items={themes} onPick={(key) => setTheme(key)} empty="No spoken feedback in these calls." /></Card>
        <Card title="Willingness to talk to a voice bot" sub="How callers reacted when the bot answered" table={{ head: ["Reaction", "Calls"], rows: att.map((i) => [i.label, i.value]) }}><HBars items={att} /></Card>
      </div>
      <div className="card-h" style={{ marginTop: 8 }}>
        <div><h2 style={{ margin: 0 }}>Comments</h2></div>
        <label style={{ fontSize: 13, color: "var(--muted)" }}>Theme <select value={theme} onChange={(e) => setTheme(e.target.value)} style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 8, padding: "4px 8px" }}><option value="all">All</option>{themes.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</select></label>
      </div>
      {rows.length ? <div className="fb">{rows.map((c) => (
        <div className="it" key={c.call_id}>
          <q>{c.feedback_text || "No excerpt was captured."}</q>
          <div className="chips" style={{ alignItems: "center" }}>
            <Badge tone="acc">{lab("feedbackTheme", c.feedback_theme)}</Badge><Pill s={c.sentiment_overall} /><Badge>Confidence {c.confidence}/5</Badge>
            <span style={{ color: "var(--muted)", fontSize: 13 }}>Call {c.call_id} · {fmtDate(c.date_ist)}, {c.time_ist}</span>
            <button className="lnk" style={{ marginLeft: "auto" }} onClick={() => setSel(c)}>Quick look</button>
            <Link className="lnk" href={`/calls/${c.call_id}`}>Full analysis</Link>
          </div>
        </div>))}</div> : <div className="empty"><b>No spoken feedback for this selection.</b><p>Most callers hang up or are transferred without commenting. Clear a filter to widen the view.</p></div>}
    </>
  );
}
