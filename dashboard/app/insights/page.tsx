"use client";
import { useMemo } from "react";
import { findings } from "@/lib/derive";
import { buildInsights } from "@/lib/insights";
import { useStore } from "@/lib/store";
import { PageHead } from "@/components/Charts";
import InsightCard from "@/components/InsightCard";

export default function Insights() {
  const { calls } = useStore();
  const ins = useMemo(() => buildInsights(calls), [calls]);
  const groups = [...new Set(ins.map((i) => i.group))];
  return (
    <>
      <PageHead title="Insights & Recommendations" sub="Findings computed from the calls in view, ranked by how many calls they affect. Suggested actions are starting points, not conclusions." />
      <div className="card" style={{ marginBottom: 18 }}>
        <h3 style={{ marginBottom: 8 }}>Summary</h3>
        {findings(calls).map((t, i) => <p key={i} style={{ margin: "6px 0", color: "var(--muted)" }}>{t}</p>)}
      </div>
      {!ins.length ? <div className="empty"><b>No insights for this selection.</b><p>Clear the filters to see findings across all calls.</p></div> :
        groups.map((g) => (
          <section key={g}><h2>{g}</h2><div className="grid2" style={{ marginTop: 10 }}>{ins.filter((i) => i.group === g).map((i) => <InsightCard key={i.id} i={i} full />)}</div></section>
        ))}
      <p className="note">Evidence is “Strong” with 10 or more affected calls, “Moderate” with 4 to 9, and “Limited” below that. With a sample this size, treat limited findings as leads to check by listening.</p>
    </>
  );
}
