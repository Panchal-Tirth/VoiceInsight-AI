"use client";
import { Insight } from "@/lib/insights";
import { useStore } from "@/lib/store";
import { Badge } from "./Charts";
import Icon from "./Icon";

export default function InsightCard({ i, full }: { i: Insight; full?: boolean }) {
  const { goCalls } = useStore();
  return (
    <article className={`ai ${i.impact === "high" ? "hi" : ""}`}>
      <div className="tag"><Icon n="sparkles" size={14} />{i.group}{i.impact === "high" && <Badge tone="warn">High impact</Badge>}</div>
      <h3>{i.title}</h3>
      <p>{i.text}</p>
      <div className="meta">
        <span><b style={{ color: "var(--ink)" }}>{i.metric}</b> · {i.count} calls · Evidence: {i.evidence}</span>
        {i.preset && <button className="lnk" onClick={() => goCalls(i.preset!)}>View calls<Icon n="arrow" size={13} /></button>}
      </div>
      {full && <div className="act"><b>Suggested action: </b>{i.action}</div>}
    </article>
  );
}
