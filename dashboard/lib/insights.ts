import { Call } from "./types";
import { F } from "./store";
import { fmtDur, lab, pct } from "./format";
import { countBy, median } from "./derive";

export type Insight = {
  id: string; group: string; impact: "high" | "medium" | "low"; title: string; text: string; metric: string;
  count: number; evidence: "Strong" | "Moderate" | "Limited"; action: string; preset?: Partial<F>;
};
const ev = (n: number): Insight["evidence"] => (n >= 10 ? "Strong" : n >= 4 ? "Moderate" : "Limited");
const imp = (n: number, t: number): Insight["impact"] => (n / t >= 0.25 ? "high" : n / t >= 0.1 ? "medium" : "low");

/** Every number is computed from the rows passed in; nothing is estimated. */
export function buildInsights(calls: Call[]): Insight[] {
  const n = calls.length, out: Insight[] = [];
  if (!n) return out;
  const add = (i: Omit<Insight, "evidence" | "impact"> & { impact?: Insight["impact"] }) => { if (i.count > 0) out.push({ ...i, evidence: ev(i.count), impact: i.impact ?? imp(i.count, n) }); };

  const leftBot = calls.filter((c) => c.call_outcome === "abandoned_in_bot");
  add({ id: "left-bot", group: "Voice-agent performance", title: "Callers hang up while the bot is still talking", count: leftBot.length, metric: `${pct(leftBot.length, n)} of calls`,
    text: `${leftBot.length} of ${n} calls ended before the caller was passed to a person.`, action: "Review the first 40 seconds of the bot flow for the calls listed and shorten the language and category steps.", preset: { outcome: "abandoned_in_bot" } });

  const queued = calls.filter((c) => c.hold_queue), hm = median(queued.map((c) => c.hold_sec));
  const qLeft = calls.filter((c) => c.call_outcome === "abandoned_in_queue");
  add({ id: "queue", group: "Escalation", title: "Long waits for a human agent", count: queued.length, metric: hm !== null ? `Median wait ${fmtDur(hm)}` : "",
    text: `${queued.length} calls waited in the queue${qLeft.length ? `; ${qLeft.length} caller${qLeft.length > 1 ? "s" : ""} gave up there` : ""}.`, action: "Check staffing at the busiest hours and consider offering a call-back while callers wait.", preset: { esc: "yes" } });

  const miss = calls.filter((c) => c.instructions_followed === false);
  add({ id: "instr", group: "Voice-agent performance", title: "The bot did not do what the caller asked", count: miss.length, metric: `${pct(miss.length, calls.filter((c) => c.instructions_followed !== null).length)} of calls with a request`,
    text: "These are calls where the customer asked for something, such as a language or a person, and it was not done the first time.", action: "Fix the intent handling for the requests listed on the Voice Agent Quality page.", preset: { instr: "no" } });

  const lang = calls.filter((c) => c.bot_issues.includes("ignored_language_choice"));
  add({ id: "lang", group: "Voice-agent performance", title: "Language choice ignored", count: lang.length, metric: `${lang.length} calls`, text: "The caller picked Hindi or English and the bot carried on in the other language.", action: "Test the language-selection step end to end, including speech recognition of short answers like “Hindi”." });

  const rep = calls.filter((c) => c.bot_issues.includes("repeated_question"));
  add({ id: "rep", group: "Customer experience", title: "Callers asked the same question twice", count: rep.length, metric: `${rep.length} calls`, text: "The bot repeated a question the caller had already answered.", action: "Add a confirmation step instead of re-asking when the answer was heard but low-confidence." });

  const resolved = calls.filter((c) => c.resolved === "yes").length;
  add({ id: "res", group: "Resolution", title: "Few calls end with a confirmed resolution", count: n - resolved, metric: `${pct(resolved, n)} resolved`, text: `Only ${resolved} of ${n} calls ended with the issue clearly resolved. Many ended before the agent phase or the audio was too unclear to tell.`, action: "Log a resolution reason at the end of each agent call so this can be measured directly.", preset: { resolved: "unknown" } });

  const unk = calls.filter((c) => c.sentiment_overall === "unknown");
  add({ id: "unk", group: "Processing quality", title: "Sentiment could not be read on many calls", count: unk.length, metric: `${pct(unk.length, n)} of calls`, text: "Audio after the transfer is often noisy, so the model returns “unclear” rather than guess.", action: "If possible, record caller and agent on separate channels and keep the original recording quality.", preset: { sent: "unknown" }, impact: unk.length / n >= 0.3 ? "high" : "medium" });

  const top = [...countBy(calls, (c) => c.issue_category)].filter(([k]) => k !== "not_discussed" && k !== "other").sort((a, b) => b[1] - a[1])[0];
  if (top) add({ id: "top", group: "Recurring issues", title: `Most common issue: ${lab("issue", top[0])}`, count: top[1], metric: `${pct(top[1], n)} of calls`, text: `${top[1]} calls were about ${lab("issue", top[0]).toLowerCase()}.`, action: "Consider a self-service answer or a dedicated bot flow for this topic.", preset: { issue: top[0] } });

  const rank = { high: 0, medium: 1, low: 2 };
  return out.sort((a, b) => rank[a.impact] - rank[b.impact] || b.count - a.count);
}
