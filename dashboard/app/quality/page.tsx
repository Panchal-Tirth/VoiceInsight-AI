"use client";
import { useMemo } from "react";
import { botIssueCounts, countBy, kpis, median } from "@/lib/derive";
import { fmtDur, lab, pct } from "@/lib/format";
import { useStore } from "@/lib/store";
import { Badge, Card, HBars, Item, Kpi, PageHead, VBars } from "@/components/Charts";

export default function Quality() {
  const { calls, goCalls, setSel } = useStore();
  const k = useMemo(() => kpis(calls), [calls]);
  const lang = calls.filter((c) => c.language_request_honored !== null);
  const langOk = lang.filter((c) => c.language_request_honored).length;
  const issues: Item[] = botIssueCounts(calls);
  const score = [1, 2, 3, 4, 5].map((s) => ({ label: String(s), value: calls.filter((c) => c.bot_guidance_score === s).length }));
  const missed = calls.filter((c) => c.missed_instructions.length);
  const failures = calls.filter((c) => c.call_outcome === "bot_failure");
  const botT = calls.filter((c) => c.bot_end_sec > 0).map((c) => c.bot_end_sec);
  const eff = [["Under 30s", (s: number) => s < 30], ["30-60s", (s: number) => s >= 30 && s < 60], ["1-2 min", (s: number) => s >= 60 && s < 120], ["Over 2 min", (s: number) => s >= 120]] as [string, (s: number) => boolean][];
  const effort = eff.map(([label, fn]) => ({ label, value: calls.filter((c) => fn(c.bot_end_sec)).length }));
  const outcomes: Item[] = [...countBy(calls, (c) => c.call_outcome)].map(([key, value]) => ({ key, label: lab("outcome", key), value })).sort((a, b) => b.value - a.value);
  const rep = calls.filter((c) => c.bot_issues.includes("repeated_question")).length;

  return (
    <>
      <PageHead title="Voice Agent Quality" sub="How well the voice bot understood callers, followed their requests and handed them over." />
      <div className="kpis">
        <Kpi icon="bot" label="Guidance score" value={k.guidance === null ? "–" : `${k.guidance.toFixed(1)} / 5`} sub={`${k.guidanceN} calls scored`} tip="1 = confusing or unhelpful, 5 = clear and effective. Scored by the model with evidence from the call." />
        <Kpi icon="check" tone="good" label="Requests followed" value={pct(k.instrOk, k.instrN)} sub={`${k.instrOk} of ${k.instrN} calls with a request`} />
        <Kpi icon="message" tone="teal" label="Language choice honoured" value={pct(langOk, lang.length)} sub={`${langOk} of ${lang.length} calls`} />
        <Kpi icon="alert" tone="warn" label="Repeated questions" value={String(rep)} sub="Calls where the bot asked twice" />
        <Kpi icon="clock" label="Median time with bot" value={fmtDur(median(botT))} sub="Before handoff or hang-up" />
      </div>
      <div className="grid2">
        <Card title="Guidance score" sub="1 is poor, 5 is excellent" table={{ head: ["Score", "Calls"], rows: score.map((s) => [s.label, s.value]) }}><VBars items={score} /></Card>
        <Card title="Potential failure patterns" sub="Problems seen, a call can have several. Click to see the calls." table={{ head: ["Problem", "Calls"], rows: issues.map((i) => [i.label, i.value]) }}>
          <HBars items={issues} total={k.n} color="var(--neg)" empty="No bot problems were found." onPick={() => goCalls({ instr: "no" })} />
        </Card>
        <Card title="Conversation efficiency" sub="How long callers spent with the bot" table={{ head: ["Time with bot", "Calls"], rows: effort.map((e) => [e.label, e.value]) }}><VBars items={effort} /></Card>
        <Card title="Resolution performance" sub="How calls ended" table={{ head: ["Outcome", "Calls"], rows: outcomes.map((i) => [i.label, i.value]) }}><HBars items={outcomes} onPick={(key) => goCalls({ outcome: key })} /></Card>
        <Card title="Requests the bot missed" sub="What the caller asked for and did not get">
          {missed.length ? <div className="scroll"><table className="tbl"><thead><tr><th>Call</th><th>Missed request</th></tr></thead><tbody>{missed.slice(0, 10).map((c) => <tr key={c.call_id} style={{ cursor: "pointer" }} onClick={() => setSel(c)}><td>{c.call_id}</td><td>{c.missed_instructions.join("; ")}</td></tr>)}</tbody></table></div> : <p className="note">No missed requests were recorded.</p>}
        </Card>
        <Card title="Bot failures" sub="Calls where the bot could not move the caller forward">
          {failures.length ? <div className="scroll"><table className="tbl"><thead><tr><th>Call</th><th>Severity</th><th>Evidence</th></tr></thead><tbody>{failures.slice(0, 10).map((c) => <tr key={c.call_id} style={{ cursor: "pointer" }} onClick={() => setSel(c)}><td>{c.call_id}</td><td><Badge tone={c.confidence >= 4 ? "bad" : "warn"}>{c.confidence >= 4 ? "Clear" : "Possible"}</Badge></td><td>{c.evidence_bot || "–"}</td></tr>)}</tbody></table></div> : <p className="note">No bot failures in this selection.</p>}
        </Card>
      </div>
    </>
  );
}
