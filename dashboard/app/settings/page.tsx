"use client";
import { useStore } from "@/lib/store";
import { Card, PageHead } from "@/components/Charts";

export default function Settings() {
  const { data, reset, toast } = useStore();
  if (!data) return null;
  const v = data.quality.validation, m = data.meta;
  return (
    <>
      <PageHead title="Settings" sub="Dataset details and how the numbers were produced." />
      <div className="grid2">
        <Card title="Dataset">
          <table className="tbl"><tbody>
            <tr><td>Analysed calls</td><td className="num">{m.n_calls}</td></tr>
            <tr><td>Sample seed</td><td className="num">{m.sample.seed}</td></tr>
            <tr><td>Longest call included</td><td className="num">{m.sample.max_duration_sec}s</td></tr>
            <tr><td>Speech model</td><td className="num">{m.whisper_model}</td></tr>
            {Object.entries(m.models).map(([k, c]) => <tr key={k}><td>Analysed by {k}</td><td className="num">{c}</td></tr>)}
            <tr><td>Built</td><td className="num">{new Date(m.generated_at).toLocaleString("en-IN")}</td></tr>
          </tbody></table>
        </Card>
        <Card title="Preferences">
          <p style={{ color: "var(--muted)", marginTop: 0 }}>Use the sun / moon button in the top bar to switch theme, and the sidebar’s Collapse button to shrink the menu. Both are remembered in this browser.</p>
          <button className="btn" onClick={() => { reset(); toast("Filters cleared"); }}>Clear all filters</button>
        </Card>
      </div>
      <h2>How this was measured, and what to trust</h2>
      <div className="card method"><ul>
        <li>Audio was transcribed with {m.whisper_model}. Hold-queue announcements and unclear audio were removed before a language model read each call.</li>
        <li>Call length, queue time and whether the rating prompt was reached are measured from the audio timeline in code, not guessed by the model.</li>
        <li>The agent part of many calls is noisy Hindi, so sentiment is often marked “could not be read”. We report that rather than invent a number.</li>
        <li>{data.quality.calls_with_overrides} calls had a field corrected by consistency rules (for example, a call that ended in the queue cannot be marked resolved).</li>
        <li>The rating the caller pressed on the phone is not in the audio text, so satisfaction here comes from what was said.</li>
        <li>No trend arrows are shown because there is no earlier period to compare against.</li>
      </ul>
        {v ? <div className="scroll"><table className="tbl"><thead><tr><th>Checked against {v.n_labelled} calls listened to by hand</th><th className="num">Agree</th><th className="num">Share</th></tr></thead>
          <tbody>{Object.entries(v.fields).map(([n, x]) => <tr key={n}><td>{n}</td><td className="num">{x.agree} of {x.n}</td><td className="num">{x.agreement_pct}%</td></tr>)}</tbody></table></div>
          : <p className="note">Not yet checked by hand. Label <code>validation/hand_labels_template.csv</code>, save it as <code>hand_labels.csv</code>, run <code>python src/validate.py</code>, then <code>python src/aggregate.py</code>.</p>}
      </div>
    </>
  );
}
