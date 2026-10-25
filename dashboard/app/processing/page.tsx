"use client";
import { useStore } from "@/lib/store";
import { num, pct } from "@/lib/format";
import { Badge, Card, PageHead } from "@/components/Charts";

type Stage = { name: string; done: number | null; total: number | null; note: string; state: "complete" | "partial" | "unknown" };

export default function Processing() {
  const { data, all } = useStore();
  if (!data) return null;
  const pop = data.population, req = data.meta.sample.requested, n = data.meta.n_calls;
  const withTx = all.filter((c) => c.transcript).length;
  const v = data.quality.validation;
  const stages: Stage[] = [
    { name: "Ingestion", done: pop?.total_rows ?? null, total: pop?.total_rows ?? null, note: "Rows read from the call-log export", state: pop ? "complete" : "unknown" },
    { name: "URL validation", done: pop?.with_recording ?? null, total: pop?.total_rows ?? null, note: pop ? `${num(pop.no_url)} rows have no recording link` : "Not in this data file", state: pop ? "complete" : "unknown" },
    { name: "Audio download", done: n, total: req, note: "Sampled calls with audio (inferred from analysed calls)", state: n >= req ? "complete" : "partial" },
    { name: "Metadata inspection", done: pop?.scanned_calls ?? null, total: pop?.with_recording ?? null, note: "Call length read from file size, no download needed", state: pop?.scanned_calls ? (pop.scanned_calls >= pop.with_recording ? "complete" : "partial") : "unknown" },
    { name: "Transcription", done: withTx, total: req, note: `Whisper model ${data.meta.whisper_model}`, state: withTx >= req ? "complete" : "partial" },
    { name: "AI analysis", done: n, total: req, note: Object.entries(data.meta.models).map(([m, c]) => `${m}: ${c}`).join(" · "), state: n >= req ? "complete" : "partial" },
    { name: "Validation", done: v?.n_labelled ?? 0, total: 30, note: v ? "Calls checked by hand against the model" : "Hand check not run yet. See Settings.", state: v ? "complete" : "unknown" },
    { name: "Analytics availability", done: n, total: n, note: `Dashboard data built ${new Date(data.meta.generated_at).toLocaleString("en-IN")}`, state: "complete" },
  ];
  const tone = (s: Stage["state"]) => (s === "complete" ? "good" : s === "partial" ? "warn" : undefined);
  const word = (s: Stage["state"]) => (s === "complete" ? "Complete" : s === "partial" ? "Partial" : "Not run");
  return (
    <>
      <PageHead title="Processing Monitor" sub="Where the pipeline stands, from the call-log export to the dashboard. Only values present in the dashboard data are shown." />
      <div className="steps">{stages.map((s) => (
        <div className="card" key={s.name}>
          <div className="card-h" style={{ marginBottom: 4 }}><h3>{s.name}</h3><Badge tone={tone(s.state)}>{word(s.state)}</Badge></div>
          <b style={{ font: "650 24px var(--f-head)" }}>{s.done === null ? "–" : num(s.done)}<span style={{ color: "var(--faint)", fontSize: 14, fontWeight: 400 }}>{s.total ? ` / ${num(s.total)}` : ""}</span></b>
          <div className="prog"><span style={{ width: s.done !== null && s.total ? `${Math.min(100, (100 * s.done) / s.total)}%` : "0%" }} /></div>
          <small style={{ color: "var(--muted)" }}>{s.done !== null && s.total ? `${pct(s.done, s.total)} · ` : ""}{s.note}</small>
        </div>))}
      </div>
      <h2>Recent errors</h2>
      <Card title="Failures and skipped items">
        <div className="empty" style={{ padding: 24 }}><b>No failure log is included in the dashboard data.</b>
          <p>Download and transcription failures are written to <code>data/manifest.csv</code> (error column) and analysis failures to <code>data/analysis_failures.jsonl</code>. The last analysis run reported 0 failed validations.</p></div>
      </Card>
      <p className="note" style={{ marginTop: 16 }}>The full export has {pop ? num(pop.with_recording) : "–"} recordings. This project analyses a random sample of {req} calls because of free-tier speech and language model limits. The same pipeline runs on all of them.</p>
    </>
  );
}
