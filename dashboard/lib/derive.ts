import { Call } from "./types";
import { fmtDur, lab, pct } from "./format";

export const countBy = <T extends string | number | boolean>(calls: Call[], f: (c: Call) => T | null | undefined) => {
  const m = new Map<string, number>();
  for (const c of calls) { const k = f(c); if (k === null || k === undefined) continue; const s = String(k); m.set(s, (m.get(s) ?? 0) + 1); }
  return m;
};
export const median = (a: number[]): number | null => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y), i = Math.floor(s.length / 2);
  return s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2;
};
export const mean = (a: number[]): number | null => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

export type Phases = { bot: number; hold: number; conv: number };
/** Split a call's seconds into bot / hold queue / conversation. Always sums to the call length. */
export const phases = (c: Call): Phases => {
  const dur = Math.max(c.duration_sec, 0.1);
  const bot = Math.min(Math.max(c.bot_end_sec, 0), dur);
  let hold = 0;
  if (c.hold_queue && c.hold_start_sec !== null && c.hold_end_sec !== null) {
    hold = Math.max(0, Math.min(c.hold_end_sec, dur) - Math.max(c.hold_start_sec, bot));
  }
  const botEff = c.hold_queue && c.hold_start_sec !== null ? Math.max(bot, Math.min(c.hold_start_sec, dur)) : bot;
  return { bot: botEff, hold, conv: Math.max(dur - botEff - hold, 0) };
};

export const kpis = (calls: Call[]) => {
  const n = calls.length;
  const known = calls.filter((c) => c.sentiment_overall !== "unknown");
  const holds = calls.filter((c) => c.hold_queue).map((c) => c.hold_sec);
  const scores = calls.filter((c) => c.bot_guidance_score !== null).map((c) => c.bot_guidance_score as number);
  const instr = calls.filter((c) => c.instructions_followed !== null);
  const totalDur = calls.reduce((a, c) => a + c.duration_sec, 0);
  const reached = calls.filter((c) => c.reached_human_agent).length;
  return {
    n, known: known.length,
    pos: calls.filter((c) => c.sentiment_overall === "positive").length,
    neu: calls.filter((c) => c.sentiment_overall === "neutral").length,
    neg: calls.filter((c) => c.sentiment_overall === "negative").length,
    reached, left: calls.filter((c) => c.call_outcome === "abandoned_in_bot" || c.call_outcome === "abandoned_in_queue").length,
    leftBot: calls.filter((c) => c.call_outcome === "abandoned_in_bot").length,
    leftQueue: calls.filter((c) => c.call_outcome === "abandoned_in_queue").length,
    holdN: holds.length, holdMedian: median(holds), holdTotal: holds.reduce((a, b) => a + b, 0), totalDur,
    guidance: mean(scores), guidanceN: scores.length,
    instrN: instr.length, instrOk: instr.filter((c) => c.instructions_followed).length,
    survey: calls.filter((c) => c.survey_reached).length,
    verbal: calls.filter((c) => c.verbal_feedback_given).length,
  };
};

/** Plain-language findings, every number computed from the rows shown. */
export const findings = (calls: Call[]): string[] => {
  const k = kpis(calls);
  const out: string[] = [];
  if (!k.n) return out;
  if (k.holdN && k.totalDur) {
    out.push(`Waiting in the hold queue took ${pct(k.holdTotal, k.totalDur)} of all call time. The median caller who waited stood by for ${fmtDur(k.holdMedian)}.`);
  }
  if (k.left) {
    out.push(`${pct(k.left, k.n)} of calls ended before a person picked up: ${k.leftBot} during the bot, ${k.leftQueue} in the queue.`);
  }
  if (k.instrN) {
    const bad = k.instrN - k.instrOk;
    out.push(`In ${bad} of ${k.instrN} calls where the customer asked the bot for something, the bot did not do it the first time.`);
  }
  out.push(`Customer sentiment could be read in ${pct(k.known, k.n)} of calls. ${k.known ? `Among those, ${pct(k.pos, k.known)} were positive and ${pct(k.neg, k.known)} negative.` : ""}`.trim());
  return out;
};

export const sentimentMix = (calls: Call[]) => {
  const m = countBy(calls, (c) => c.sentiment_overall);
  return ["negative", "neutral", "positive", "unknown"].map((key) => ({ key, label: lab("sentiment", key), value: m.get(key) ?? 0 }));
};

/** Count each bot problem across calls (a call can contribute several). */
export const botIssueCounts = (calls: Call[]): { key: string; label: string; value: number }[] => {
  const m = new Map<string, number>();
  for (const c of calls) for (const b of c.bot_issues) if (b !== "none") m.set(b, (m.get(b) ?? 0) + 1);
  return [...m.entries()].map(([key, value]) => ({ key, label: lab("botIssue", key), value })).sort((a, b) => b.value - a.value);
};
