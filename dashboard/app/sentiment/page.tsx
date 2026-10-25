"use client";
import { useMemo } from "react";
import { botIssueCounts, countBy, kpis } from "@/lib/derive";
import { fmtDate, lab, pct } from "@/lib/format";
import { useStore } from "@/lib/store";
import { Card, HBars, Item, Kpi, Legend, PageHead, Seg, StackBar, VBars } from "@/components/Charts";
import { Pill } from "@/components/Explorer";

const SC: Record<string, string> = { negative: "var(--neg)", neutral: "var(--neu)", positive: "var(--pos)", unknown: "var(--unk)" };
const ORDER = ["negative", "neutral", "positive", "unknown"];
const segs = (cs: { sentiment_overall: string }[]): Seg[] => ORDER.map((s) => ({ key: s, label: lab("sentiment", s), value: cs.filter((c) => c.sentiment_overall === s).length, color: SC[s], hatch: s === "unknown" }));

export default function SentimentPage() {
  const { calls, goCalls, setSel } = useStore();
  const k = useMemo(() => kpis(calls), [calls]);
  const by = (get: (c: (typeof calls)[number]) => string, group: string) => [...new Set(calls.map(get))].map((v) => ({ v, label: lab(group, v), cs: calls.filter((c) => get(c) === v) })).sort((a, b) => b.cs.length - a.cs.length);
  const cats = by((c) => c.issue_category, "issue"), langs = by((c) => c.language_chosen, "language"), days = by((c) => c.date_ist, "x").sort((a, b) => a.v.localeCompare(b.v));
  const trans = ORDER.map((a) => ORDER.map((b) => calls.filter((c) => c.sentiment_start === a && c.sentiment_end === b).length));
  const maxT = Math.max(...trans.flat(), 1);
  const bad = calls.filter((c) => c.sentiment_overall === "negative" || (c.sentiment_overall !== "positive" && c.resolved === "no")).sort((a, b) => b.duration_sec - a.duration_sec).slice(0, 8);
  const themes: Item[] = botIssueCounts(calls.filter((c) => c.sentiment_overall === "negative"));
  const holdB = [["No wait", (s: number) => s === 0], ["Under 1 min", (s: number) => s > 0 && s < 60], ["1-3 min", (s: number) => s >= 60 && s < 180], ["3-5 min", (s: number) => s >= 180 && s < 300], ["Over 5 min", (s: number) => s >= 300]] as [string, (s: number) => boolean][];
  const effort = holdB.map(([label, fn]) => ({ label, value: calls.filter((c) => fn(c.hold_sec)).length }));
  const attitude: Item[] = [...countBy(calls, (c) => c.customer_bot_attitude)].map(([key, value]) => ({ key, label: lab("attitude", key), value })).sort((a, b) => b.value - a.value);

  return (
    <>
      <PageHead title="Sentiment & Experience" sub="How callers felt, how that changed during the call, and where friction showed up. Sentiment, resolution and satisfaction are separate measures." />
      <div className="kpis">
        <Kpi icon="up" tone="good" label="Positive" value={String(k.pos)} sub={pct(k.pos, k.n) + " of calls"} />
        <Kpi icon="smile" label="Neutral" value={String(k.neu)} sub={pct(k.neu, k.n) + " of calls"} />
        <Kpi icon="down" tone="bad" label="Negative" value={String(k.neg)} sub={pct(k.neg, k.n) + " of calls"} />
        <Kpi icon="alert" tone="warn" label="Could not be read" value={String(k.n - k.known)} sub="Audio too unclear to judge" tip="We report these as unclear instead of guessing." />
      </div>
      <div className="grid2">
        <Card title="Initial vs final sentiment" sub="Rows are how the call started, columns how it ended" table={{ head: ["Start \\ End", ...ORDER.map((s) => lab("sentiment", s))], rows: ORDER.map((a, i) => [lab("sentiment", a), ...trans[i]]) }}>
          <div className="scroll"><table className="tbl heat"><thead><tr><th>Start \ End</th>{ORDER.map((s) => <th key={s}>{lab("sentiment", s)}</th>)}</tr></thead>
            <tbody>{ORDER.map((a, i) => <tr key={a}><th>{lab("sentiment", a)}</th>{trans[i].map((v, j) => <td key={j} style={{ background: v ? `color-mix(in srgb, var(--accent) ${Math.round(8 + (v / maxT) * 52)}%, transparent)` : undefined }}>{v}</td>)}</tr>)}</tbody></table></div>
        </Card>
        <Card title="Sentiment by day" sub="Share of each day’s calls" table={{ head: ["Date", ...ORDER.map((s) => lab("sentiment", s))], rows: days.map((d) => [fmtDate(d.v), ...segs(d.cs).map((s) => s.value)]) }}>
          {days.map((d) => <div className="stack-row" key={d.v}><span>{fmtDate(d.v)}</span><StackBar segs={segs(d.cs)} /></div>)}
          <Legend items={ORDER.map((s) => ({ label: lab("sentiment", s), color: SC[s], hatch: s === "unknown" }))} />
        </Card>
        <Card title="Sentiment by support category" sub="Click a category to open its calls" table={{ head: ["Category", ...ORDER.map((s) => lab("sentiment", s))], rows: cats.map((d) => [d.label, ...segs(d.cs).map((s) => s.value)]) }}>
          {cats.map((d) => <div className="stack-row" key={d.v}><button onClick={() => goCalls({ issue: d.v })} title={d.label}>{d.label} ({d.cs.length})</button><StackBar segs={segs(d.cs)} /></div>)}
          <Legend items={ORDER.map((s) => ({ label: lab("sentiment", s), color: SC[s], hatch: s === "unknown" }))} />
        </Card>
        <Card title="Sentiment by language" sub="Language the caller chose" table={{ head: ["Language", ...ORDER.map((s) => lab("sentiment", s))], rows: langs.map((d) => [d.label, ...segs(d.cs).map((s) => s.value)]) }}>
          {langs.map((d) => <div className="stack-row" key={d.v}><button onClick={() => goCalls({ lang: d.v })}>{d.label} ({d.cs.length})</button><StackBar segs={segs(d.cs)} /></div>)}
          <Legend items={ORDER.map((s) => ({ label: lab("sentiment", s), color: SC[s], hatch: s === "unknown" }))} />
        </Card>
        <Card title="Customer effort: time spent waiting" sub="How long callers sat in the hold queue" table={{ head: ["Wait", "Calls"], rows: effort.map((e) => [e.label, e.value]) }}><VBars items={effort} /></Card>
        <Card title="Willingness to talk to the bot" sub="How callers reacted to the bot" table={{ head: ["Reaction", "Calls"], rows: attitude.map((i) => [i.label, i.value]) }}><HBars items={attitude} /></Card>
        <Card title="Frustration themes" sub="Bot problems seen in negative calls" table={{ head: ["Problem", "Calls"], rows: themes.map((i) => [i.label, i.value]) }}><HBars items={themes} color="var(--neg)" empty="No bot problems were recorded in negative calls." /></Card>
        <Card title="Negative or unresolved calls" sub="Longest first. Click to open.">
          {bad.length ? <div className="scroll"><table className="tbl"><tbody>{bad.map((c) => <tr key={c.call_id} style={{ cursor: "pointer" }} onClick={() => setSel(c)}><td>{c.call_id}</td><td><Pill s={c.sentiment_overall} /></td><td>{lab("issue", c.issue_category)}</td><td>{lab("outcome", c.call_outcome)}</td></tr>)}</tbody></table></div> : <p className="note">None for this selection.</p>}
        </Card>
      </div>
    </>
  );
}
