"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { phases } from "@/lib/derive";
import { fmtDate, fmtDur, lab } from "@/lib/format";
import { Badge } from "@/components/Charts";
import { Pill } from "@/components/Explorer";
import Icon from "@/components/Icon";

type Line = { sec: number | null; text: string; hold: boolean };
const parse = (t: string): Line[] => t.split("\n").filter(Boolean).map((l) => {
  const m = l.match(/^\[(\d+):(\d+)(?:-[\d:]+)?\]\s*(.*)$/);
  const text = m ? m[3] : l;
  return { sec: m ? +m[1] * 60 + +m[2] : null, text, hold: text.startsWith("(HOLD QUEUE") || text.startsWith("(unclear") };
});
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

function Sec({ title, value, children, open }: { title: string; value: ReactNode; children?: ReactNode; open?: boolean }) {
  return <details className="sec" open={open}><summary><span>{title}</span><span className="r">{value}</span></summary>{children && <div className="b">{children}</div>}</details>;
}

export default function CallDetail() {
  const { id } = useParams<{ id: string }>();
  const { all, toast } = useStore();
  const call = all.find((c) => String(c.call_id) === id);
  const lines = useMemo(() => parse(call?.transcript ?? ""), [call]);
  const audio = useRef<HTMLAudioElement>(null);
  const [t, setT] = useState(0), [dur, setDur] = useState(0), [play, setPlay] = useState(false), [rate, setRate] = useState(1), [vol, setVol] = useState(1), [q, setQ] = useState("");
  useEffect(() => { if (audio.current) { audio.current.playbackRate = rate; audio.current.volume = vol; } }, [rate, vol]);
  if (!call) return <div className="empty"><b>Call not found</b><p>It may be outside the analysed sample. <Link href="/calls" className="lnk">Back to Call Explorer</Link></p></div>;

  const p = phases(call);
  const activeIdx = lines.reduce((a, l, i) => (l.sec !== null && l.sec <= t ? i : a), -1);
  const seek = (s: number | null) => { if (s !== null && audio.current) { audio.current.currentTime = s; setT(s); } };
  const shown = q.trim() ? lines.filter((l) => l.text.toLowerCase().includes(q.toLowerCase())) : lines;
  const hl = (s: string) => { if (!q.trim()) return s; const i = s.toLowerCase().indexOf(q.toLowerCase()); return i < 0 ? s : <>{s.slice(0, i)}<mark>{s.slice(i, i + q.length)}</mark>{s.slice(i + q.length)}</>; };
  const yn = (v: boolean | null) => (v === null ? "Not applicable" : v ? "Yes" : "No");
  const resTone = call.resolved === "yes" ? "good" : call.resolved === "no" ? "bad" : call.resolved === "partial" ? "warn" : undefined;

  return (
    <>
      <p style={{ margin: "0 0 10px" }}><Link href="/calls" className="lnk"><Icon n="left" size={14} />Back to Call Explorer</Link></p>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-h" style={{ marginBottom: 8 }}>
          <div><h1>Call {call.call_id}</h1><p>{fmtDate(call.date_ist)}, {call.time_ist} IST · {fmtDur(call.duration_sec)} · {lab("language", call.language_chosen)}</p></div>
          <div className="chips"><Pill s={call.sentiment_overall} /><Badge tone={resTone}>{lab("resolved", call.resolved)}</Badge><Badge tone={call.reached_human_agent ? "acc" : undefined}>{call.reached_human_agent ? "Human agent reached" : "No human agent"}</Badge></div>
        </div>
        <p style={{ margin: 0 }}>{call.issue_summary}</p>
      </div>

      <div className="detail">
        <div style={{ display: "grid", gap: 16 }}>
          <section className="card">
            <h3 style={{ marginBottom: 12 }}>Recording</h3>
            {call.recording_url ? (
              <div className="player">
                <audio ref={audio} src={call.recording_url} preload="metadata" onTimeUpdate={(e) => setT(e.currentTarget.currentTime)} onLoadedMetadata={(e) => setDur(e.currentTarget.duration)} onPlay={() => setPlay(true)} onPause={() => setPlay(false)} />
                <button className="pp" aria-label={play ? "Pause" : "Play"} onClick={() => (play ? audio.current?.pause() : audio.current?.play())}><Icon n={play ? "pause" : "play"} size={16} /></button>
                <input type="range" min={0} max={dur || call.duration_sec} step={0.1} value={t} aria-label="Seek" onChange={(e) => seek(+e.target.value)} />
                <span style={{ fontSize: 13, color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>{mmss(t)} / {mmss(dur || call.duration_sec)}</span>
                <div className="ctl">
                  <label>Speed <select value={rate} onChange={(e) => setRate(+e.target.value)}>{[0.75, 1, 1.25, 1.5, 2].map((r) => <option key={r} value={r}>{r}×</option>)}</select></label>
                  <label>Volume <input type="range" min={0} max={1} step={0.05} value={vol} onChange={(e) => setVol(+e.target.value)} style={{ width: 90, accentColor: "var(--accent)" }} /></label>
                  <span>Click a transcript line to jump to it.</span>
                </div>
              </div>
            ) : <p className="note">The recording link is not in the dashboard data yet. Re-run <code>python src/aggregate.py</code> with the updated file to add it.</p>}
            <div className="rbar" style={{ height: 12, marginTop: 14 }}>
              {p.bot > 0 && <i className="ph-bot" style={{ flex: p.bot }} />}{p.hold > 0 && <i className="ph-hold" style={{ flex: p.hold }} />}{p.conv > 0 && <i className="ph-conv" style={{ flex: p.conv }} />}
            </div>
            <div className="legend"><span><i className="ph-bot" />Bot {fmtDur(p.bot)}</span><span><i className="ph-hold" />Queue {fmtDur(p.hold)}</span><span><i className="ph-conv" />After {fmtDur(p.conv)}</span></div>
          </section>

          <section className="card">
            <div className="card-h">
              <div><h3>Transcript</h3><p>Cleaned timeline. Hold-queue announcements are collapsed. Speaker labels are not available because the recording is a single channel.</p></div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <input className="search" type="search" placeholder="Search transcript" aria-label="Search transcript" value={q} onChange={(e) => setQ(e.target.value)} style={{ minWidth: 160 }} />
                <button className="btn" onClick={() => { navigator.clipboard?.writeText(call.transcript).then(() => toast("Transcript copied"), () => toast("Could not copy")); }}><Icon n="copy" size={15} />Copy</button>
              </div>
            </div>
            {!lines.length ? <p className="note">No transcript is available for this call.</p> : !shown.length ? <p className="note">No lines match this search.</p> : (
              <div className="tl">{shown.map((l, i) => (
                <button key={i} className={`${lines.indexOf(l) === activeIdx && play ? "on" : ""} ${l.hold ? "hold" : ""}`} onClick={() => seek(l.sec)}>
                  <time>{l.sec !== null ? mmss(l.sec) : ""}</time><span>{hl(l.text)}</span>
                </button>))}</div>
            )}
          </section>
        </div>

        <aside className="card">
          <h3>AI analysis</h3>
          <p className="note" style={{ margin: "10px 0" }}>Measured from the audio timeline: hold, queue and rating-prompt facts. Everything else is the model’s interpretation, with the evidence it relied on.</p>
          <Sec title="Overall sentiment" value={<Pill s={call.sentiment_overall} />} open>{call.evidence_sentiment || "Insufficient evidence."}</Sec>
          <Sec title="Initial → final sentiment" value={`${lab("sentiment", call.sentiment_start)} → ${lab("sentiment", call.sentiment_end)}`} />
          <Sec title="Customer intent" value={lab("issue", call.issue_category)}>{call.issue_summary}</Sec>
          <Sec title="Explicit feedback" value={call.verbal_feedback_given ? lab("feedbackTheme", call.feedback_theme) : "None given"}>{call.verbal_feedback_given ? call.feedback_text : "No spoken feedback was found. The phone-keypad rating is not part of the audio text."}</Sec>
          <Sec title="Resolution" value={<Badge tone={resTone}>{lab("resolved", call.resolved)}</Badge>}>Outcome: {lab("outcome", call.call_outcome)}.</Sec>
          <Sec title="Human escalation" value={call.reached_human_agent ? "Reached a person" : "Not reached"}>{call.hold_queue ? `Waited ${fmtDur(call.hold_sec)} in the queue (measured).` : "No hold queue was detected."}{call.queue_abandoned ? " The caller left while waiting." : ""}</Sec>
          <Sec title="Instruction following" value={yn(call.instructions_followed)}>{call.missed_instructions.length ? `Missed: ${call.missed_instructions.join("; ")}` : "No missed requests recorded."} Language request honoured: {yn(call.language_request_honored)}.</Sec>
          <Sec title="Guidance quality" value={call.bot_guidance_score ? `${call.bot_guidance_score} / 5` : "Not scored"}>{call.evidence_bot || "Insufficient evidence."}</Sec>
          <Sec title="Bot problems" value={call.bot_issues.filter((b) => b !== "none").length ? `${call.bot_issues.length} found` : "None"}>{call.bot_issues.map((b) => lab("botIssue", b)).join(", ")}</Sec>
          <Sec title="Willingness to use the bot" value={lab("attitude", call.customer_bot_attitude)} />
          <Sec title="Confidence" value={`${call.confidence} / 5`}>Transcript quality: {lab("quality", call.transcript_quality)}. Unclear audio share: {call.unclear_share !== null ? `${Math.round(call.unclear_share * 100)}%` : "unknown"} (measured). Analysed by {call.analysis_model}.</Sec>
          {call.postprocess_changes.length > 0 && <Sec title="Consistency rules" value={`${call.postprocess_changes.length} adjusted`}>{call.postprocess_changes.join("; ")}</Sec>}
        </aside>
      </div>
    </>
  );
}
