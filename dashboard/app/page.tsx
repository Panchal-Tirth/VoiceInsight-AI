"use client";
import { useMemo } from "react";
import Link from "next/link";
import { countBy, kpis } from "@/lib/derive";
import { buildInsights } from "@/lib/insights";
import { fmtDate, lab, pct } from "@/lib/format";
import { useStore } from "@/lib/store";
import { Card, Donut, HBars, Item, Kpi, LineChart, PageHead } from "@/components/Charts";
import InsightCard from "@/components/InsightCard";
import Ribbon from "@/components/Ribbon";
import Icon from "@/components/Icon";

const SC: Record<string, string> = { positive: "var(--pos)", neutral: "var(--neu)", negative: "var(--neg)", unknown: "var(--unk)" };
const items = (m: Map<string, number>, group: string, skip: string[] = []): Item[] =>
  [...m.entries()].filter(([k]) => !skip.includes(k)).map(([k, v]) => ({ key: k, label: lab(group, k), value: v })).sort((a, b) => b.value - a.value);

export default function Overview() {
  const { data, calls, all, goCalls, setSel } = useStore();
  const k = useMemo(() => kpis(calls), [calls]);
  const ins = useMemo(() => buildInsights(calls), [calls]);
  if (!data) return null;
  const n = calls.length, pop = data.population;
  const resolved = calls.filter((c) => c.resolved === "yes").length;
  const sample = data.meta.sample.requested;

  const perDay = countBy(all, (c) => c.date_ist);
  const days = pop?.by_day ?? [...perDay.keys()].sort().map((d) => ({ date: d, count: perDay.get(d) ?? 0 }));
  const analysedSeries = days.map((d) => perDay.get(d.date) ?? 0);
  const restSeries = days.map((d, i) => Math.max(d.count - analysedSeries[i], 0));

  const sent = ["positive", "neutral", "negative", "unknown"].map((s) => ({ key: s, label: lab("sentiment", s), value: calls.filter((c) => c.sentiment_overall === s).length, color: SC[s], hatch: s === "unknown" }));
  const resItems = ["yes", "partial", "no", "unknown"].map((r) => ({ key: r, label: lab("resolved", r), value: calls.filter((c) => c.resolved === r).length })).filter((x) => x.value);
  const escalated = calls.filter((c) => c.reached_human_agent).length;

  return (
    <>
      <PageHead title="Voice Intelligence Overview" sub="Understand customer experience, uncover recurring issues, and measure voice-agent performance.">
        <Link href="/calls" className="btn primary"><Icon n="phone" size={15} />Open Call Explorer</Link>
      </PageHead>

      <div className="kpis">
        <Kpi icon="phone" label="Total calls" value={String(n)} sub={pop ? `Sample of ${pop.with_recording.toLocaleString("en-IN")} recorded calls` : "Analysed calls"} tip="Calls in the analysed sample that match the current filters." />
        <Kpi icon="check" tone="teal" label="Successfully processed" value={`${data.meta.n_calls}/${sample}`} sub="Transcribed and analysed" tip="Calls with a transcript and a validated analysis, out of the sample requested." />
        <Kpi icon="up" tone="good" label="Positive sentiment" value={pct(k.pos, n)} sub={`${k.pos} of ${k.known} readable calls`} tip="Customer sentiment overall. Calls with unreadable audio are counted as unclear, not guessed." />
        <Kpi icon="down" tone="bad" label="Negative sentiment" value={pct(k.neg, n)} sub={`${k.neg} of ${k.known} readable calls`} tip="Customer sentiment overall, not satisfaction and not resolution." />
        <Kpi icon="check" tone="good" label="Resolution rate" value={pct(resolved, n)} sub={`${resolved} confirmed resolved`} tip="Calls where the issue was clearly resolved. Unclear and unfinished calls are not counted as resolved." />
        <Kpi icon="user" tone="warn" label="Human escalation rate" value={pct(escalated, n)} sub="Reached a human agent" tip="Calls that were passed from the bot to a person and answered." />
      </div>

      <div className="grid2">
        <Card title="Call volume over time" sub="Daily calls in the full export, split by whether we analysed them"
          table={{ head: ["Date", "Analysed", "Not analysed"], rows: days.map((d, i) => [fmtDate(d.date), analysedSeries[i], restSeries[i]]) }}>
          <LineChart labels={days.map((d) => fmtDate(d.date))} series={[{ name: "Analysed (sample)", color: "var(--accent)", values: analysedSeries }, { name: "Not analysed", color: "var(--teal)", values: restSeries }]} />
        </Card>
        <Card title="Sentiment distribution" sub="Customer sentiment overall. Click a segment to see those calls." table={{ head: ["Sentiment", "Calls"], rows: sent.map((s) => [s.label, s.value]) }}>
          <Donut segs={sent} center={String(n)} sub="calls" onPick={(key) => goCalls({ sent: key })} />
        </Card>
        <Card title="Resolution outcomes" sub="Did the call end with the issue solved?" table={{ head: ["Resolution", "Calls"], rows: resItems.map((i) => [i.label, i.value]) }}>
          <HBars items={resItems} onPick={(key) => goCalls({ resolved: key })} />
        </Card>
        <Card title="Language distribution" sub="Language the caller chose at the start" table={{ head: ["Language", "Calls"], rows: items(countBy(calls, (c) => c.language_chosen), "language").map((i) => [i.label, i.value]) }}>
          <HBars items={items(countBy(calls, (c) => c.language_chosen), "language")} onPick={(key) => goCalls({ lang: key })} />
        </Card>
        <Card title="Top support categories" sub="From the analysis of each call" table={{ head: ["Category", "Calls"], rows: items(countBy(calls, (c) => c.issue_category), "issue").map((i) => [i.label, i.value]) }}>
          <HBars items={items(countBy(calls, (c) => c.issue_category), "issue")} onPick={(key) => goCalls({ issue: key })} />
        </Card>
        <Card title="How calls ended" sub="Where each call stopped" table={{ head: ["Outcome", "Calls"], rows: items(countBy(calls, (c) => c.call_outcome), "outcome").map((i) => [i.label, i.value]) }}>
          <HBars items={items(countBy(calls, (c) => c.call_outcome), "outcome")} onPick={(key) => goCalls({ outcome: key })} />
        </Card>
      </div>

      <h2>AI-powered insights</h2>
      <p className="lede">Findings computed from the calls above. Open the Insights page for suggested actions.</p>
      {ins.length ? <div className="grid2">{ins.slice(0, 4).map((i) => <InsightCard key={i.id} i={i} />)}</div> : <p className="note">No notable patterns for this selection.</p>}

      <h2>Every call, start to finish</h2>
      <p className="lede">Each bar is one call. Bar length is call length and colour shows where the time went. The dot is the customer’s sentiment. Click a call for a quick look.</p>
      <Ribbon calls={calls} onPick={setSel} />
    </>
  );
}
