"use client";
import { useMemo, useState } from "react";
import { Call } from "@/lib/types";
import { phases } from "@/lib/derive";
import { fmtDur, lab } from "@/lib/format";
import { useTip } from "./Tip";
import { Legend } from "./Charts";

const SENT_VAR: Record<string, string> = { positive: "var(--pos)", neutral: "var(--neu)", negative: "var(--neg)", unknown: "var(--unk)" };
export const sentColor = (s: string) => SENT_VAR[s] ?? "var(--unk)";

type Sort = "duration" | "hold" | "sentiment";

/** One row per call: bot, queue and conversation time laid end to end. */
export default function Ribbon({ calls, onPick }: { calls: Call[]; onPick: (c: Call) => void }) {
  const { show, hide } = useTip();
  const [sort, setSort] = useState<Sort>("duration");
  const rows = useMemo(() => {
    const order: Record<string, number> = { negative: 0, neutral: 1, positive: 2, unknown: 3 };
    const arr = calls.map((c) => ({ c, p: phases(c) }));
    arr.sort((a, b) => sort === "duration" ? b.c.duration_sec - a.c.duration_sec
      : sort === "hold" ? b.p.hold - a.p.hold || b.c.duration_sec - a.c.duration_sec
      : order[a.c.sentiment_overall] - order[b.c.sentiment_overall] || b.c.duration_sec - a.c.duration_sec);
    return arr;
  }, [calls, sort]);
  const max = Math.max(...calls.map((c) => c.duration_sec), 1);
  const step = max > 1500 ? 600 : max > 700 ? 300 : max > 300 ? 120 : 60;
  const ticks: number[] = [];
  for (let t = 0; t <= max; t += step) ticks.push(t);

  if (!calls.length) return <div className="note">No calls match the filters.</div>;
  return (
    <div className="ribbon-wrap">
      <div className="ribbon-tools">
        <Legend items={[{ label: "Talking to the bot", color: "var(--bot)" }, { label: "Waiting in the queue", color: "var(--hold)" }, { label: "With a person or after the queue", color: "var(--conv)" }]} />
        <div className="seg" role="group" aria-label="Sort calls">
          {(["duration", "hold", "sentiment"] as Sort[]).map((s) => (
            <button key={s} aria-pressed={sort === s} onClick={() => setSort(s)}>{s === "duration" ? "Longest first" : s === "hold" ? "Longest wait first" : "By sentiment"}</button>
          ))}
        </div>
      </div>
      <div className="ribbon">
        <div className="rax">{ticks.map((t) => <span key={t} style={{ left: `${(t / max) * 100}%` }}>{t === 0 ? "0" : fmtDur(t)}</span>)}</div>
        {rows.map(({ c, p }) => {
          const tipC = (
            <>
              <b>Call {c.call_id}</b> · {fmtDur(c.duration_sec)}<br />
              Bot {fmtDur(p.bot)} · Queue {fmtDur(p.hold)} · After {fmtDur(p.conv)}<br />
              {lab("sentiment", c.sentiment_overall)} · {lab("outcome", c.call_outcome)}
            </>
          );
          return (
            <button key={c.call_id} className="rrow" aria-label={`Call ${c.call_id}, ${fmtDur(c.duration_sec)}, ${lab("sentiment", c.sentiment_overall)}`}
              onClick={() => onPick(c)} onMouseMove={(e) => show(e, tipC)} onMouseLeave={hide} onFocus={(e) => show(e, tipC)} onBlur={hide}>
              <span className="rbar" style={{ width: `${(c.duration_sec / max) * 100}%` }}>
                {p.bot > 0 && <i className="ph-bot" style={{ flex: p.bot }} />}
                {p.hold > 0 && <i className="ph-hold" style={{ flex: p.hold }} />}
                {p.conv > 0 && <i className="ph-conv" style={{ flex: p.conv }} />}
              </span>
              <span className={`rdot ${c.sentiment_overall === "unknown" ? "hatch" : ""}`} style={{ background: sentColor(c.sentiment_overall) }} title={lab("sentiment", c.sentiment_overall)} />
            </button>
          );
        })}
      </div>
      <Legend items={[{ label: "Customer positive", color: "var(--pos)" }, { label: "Neutral", color: "var(--neu)" }, { label: "Negative", color: "var(--neg)" }, { label: "Could not be read (noisy audio)", color: "var(--unk)", hatch: true }]} />
    </div>
  );
}
