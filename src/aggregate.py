"""Phase 5: combine every per-call analysis into ONE table + the dashboard data file.

Reads : data/analysis/*.json (sample only), data/transcripts/*.json, data/sample_ids.csv, data/manifest.csv
Writes: data/processed/calls_analysis.csv   one flat row per analysed call
        data/processed/summary.json         headline KPIs (use these numbers in the report)
        dashboard/public/data.json          everything the Next.js dashboard shows
        validation/hand_labels_template.csv 30 calls to label by hand (only if it does not exist yet)

Run:  python src/aggregate.py
"""
import argparse
import json
import re
import statistics as st
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

from clean_transcript import clean
from utils import get_logger, load_config, load_manifest, path_of

log = get_logger("aggregate")

TRANSFER_RE = re.compile(r"connect(ing)? you|connect kar|कनेक्ट कर|transfer(ring)? you", re.I)
DUR_BINS = [0, 15, 30, 60, 120, 300, 900, 1e9]
DUR_LABELS = ["<15s", "15-30s", "30-60s", "1-2m", "2-5m", "5-15m", ">15m"]
LIST_FIELDS = ["bot_issues", "missed_instructions"]


def bot_end(rec, feats, outcome, dur):
    """When did the bot hand the caller over? (seconds, source)"""
    for s in (rec.get("segments") or [])[:30]:
        if s.get("start", 0) < 120 and TRANSFER_RE.search(s.get("text") or ""):
            return round(float(s["end"]), 1), "transfer_phrase"
    if feats.get("has_hold_queue") and feats.get("hold_start_sec") is not None:
        return round(float(feats["hold_start_sec"]), 1), "hold_start"
    if outcome in ("abandoned_in_bot", "bot_failure", "unclear"):
        return round(dur, 1), "whole_call"
    return round(min(dur, 40.0), 1), "assumed_40s"


def build_rows(cfg, only_sample=True):
    adir = path_of(cfg["paths"]["analysis_dir"])
    tdir = path_of(cfg["paths"]["transcripts_dir"])
    sp = path_of(cfg["paths"]["sample_ids"])
    sample = pd.read_csv(sp).set_index("call_id") if sp.exists() else None
    rows = []
    for f in sorted(adir.glob("*.json")):
        j = json.loads(f.read_text(encoding="utf-8"))
        cid = int(j["call_id"])
        if only_sample and sample is not None and cid not in sample.index:
            continue
        a, feats = j["analysis"], j["features"]
        tpath = tdir / f"{cid}.json"
        rec = json.loads(tpath.read_text(encoding="utf-8")) if tpath.exists() else {"segments": []}
        dur = float(j.get("duration_sec") or rec.get("duration_sec") or 0)
        b_end, b_src = bot_end(rec, feats, a["call_outcome"], dur)
        hold_end = feats.get("hold_end_sec")
        agent_start = hold_end if feats.get("has_hold_queue") else (b_end if a["reached_human_agent"] else None)
        meta = sample.loc[cid] if sample is not None and cid in sample.index else None
        row = {
            "call_id": cid,
            "date_ist": str(meta["date_ist"]) if meta is not None else "",
            "time_ist": str(meta["time_ist"]) if meta is not None else "",
            "hour_ist": int(meta["hour_ist"]) if meta is not None else None,
            "duration_sec": round(dur, 1),
            "asr_language": j.get("asr_language"),
            "bot_end_sec": b_end, "bot_end_source": b_src,
            "hold_queue": bool(feats.get("has_hold_queue")),
            "hold_start_sec": feats.get("hold_start_sec"), "hold_end_sec": hold_end,
            "hold_sec": float(feats.get("hold_sec") or 0),
            "agent_start_sec": agent_start,
            "survey_reached": bool(feats.get("survey_prompt_reached")),
            "queue_abandoned": bool(feats.get("queue_abandoned")),
            "unclear_share": feats.get("unclear_share"),
            "recording_url": str(meta["recording_url"]) if meta is not None and "recording_url" in meta.index else "",
            "analysis_model": j.get("model"), "tokens": j.get("tokens"),
            "postprocess_changes": j.get("postprocess_changes", []),
        }
        row.update({k: v for k, v in a.items()})
        row["transcript"] = clean(rec)["text"] if rec.get("segments") else ""
        rows.append(row)
    return rows


def pct(n, d):
    return round(100.0 * n / d, 1) if d else None


def summarize(rows):
    n = len(rows)
    c = lambda k: Counter(r[k] for r in rows)
    sent = c("sentiment_overall")
    known = n - sent.get("unknown", 0)
    holds = [r["hold_sec"] for r in rows if r["hold_queue"]]
    scores = [r["bot_guidance_score"] for r in rows if r["bot_guidance_score"] is not None]
    instr = [r["instructions_followed"] for r in rows if r["instructions_followed"] is not None]
    total_dur = sum(r["duration_sec"] for r in rows)
    return {
        "n_calls": n,
        "sentiment": dict(sent),
        "sentiment_known_share_pct": pct(known, n),
        "positive_pct_of_all": pct(sent.get("positive", 0), n),
        "positive_pct_of_known": pct(sent.get("positive", 0), known),
        "negative_pct_of_known": pct(sent.get("negative", 0), known),
        "outcomes": dict(c("call_outcome")),
        "reached_human_agent_pct": pct(sum(r["reached_human_agent"] for r in rows), n),
        "abandoned_before_agent_pct": pct(sum(r["call_outcome"] in ("abandoned_in_bot", "abandoned_in_queue") for r in rows), n),
        "calls_with_hold_queue": len(holds),
        "median_hold_sec": round(st.median(holds), 1) if holds else None,
        "mean_hold_sec": round(st.mean(holds), 1) if holds else None,
        "hold_share_of_total_call_time_pct": pct(sum(holds), total_dur),
        "bot_guidance_mean": round(st.mean(scores), 2) if scores else None,
        "bot_guidance_scored_calls": len(scores),
        "instructions_followed_pct": pct(sum(1 for x in instr if x), len(instr)),
        "instructions_scored_calls": len(instr),
        "survey_prompt_reached_pct": pct(sum(r["survey_reached"] for r in rows), n),
        "verbal_feedback_calls": sum(r["verbal_feedback_given"] for r in rows),
        "language_chosen": dict(c("language_chosen")),
        "customer_bot_attitude": dict(c("customer_bot_attitude")),
        "issue_category": dict(c("issue_category")),
        "resolved": dict(c("resolved")),
        "transcript_quality": dict(c("transcript_quality")),
        "models": dict(c("analysis_model")),
    }


def population_stats(cfg):
    mp = path_of(cfg["paths"]["manifest"])
    if not mp.exists():
        return None
    m = load_manifest(mp)
    usable = m[m["status"] == "pending"].copy()
    out = {"total_rows": int(len(m)), "with_recording": int(len(usable)),
           "no_url": int((m["status"] == "no_url").sum())}
    out["by_day"] = [{"date": str(k), "count": int(v)} for k, v in usable.groupby("date_ist").size().items()]
    out["by_hour"] = [{"hour": int(k), "count": int(v)} for k, v in usable.groupby("hour_ist").size().items()]
    d = usable["est_duration_sec"].dropna().astype(float)
    if len(d):
        b = pd.cut(d, bins=DUR_BINS, labels=DUR_LABELS).value_counts().reindex(DUR_LABELS)
        out["duration_buckets"] = [{"label": k, "count": int(v)} for k, v in b.items()]
        out["scanned_calls"] = int(len(d))
        out["median_duration_sec"] = round(float(d.median()), 1)
        out["total_audio_hours"] = round(float(d.sum()) / 3600, 1)
        out["under_30s"] = int((d < 30).sum())
        out["under_30s_pct"] = pct(int((d < 30).sum()), len(d))
        out["over_15min"] = int((d > 900).sum())
    return out


def label_template(rows, cfg, n=30, seed=7):
    out = path_of("validation/hand_labels_template.csv")
    if out.exists() or len(rows) < 5:
        return
    sp = pd.read_csv(path_of(cfg["paths"]["sample_ids"]))
    urls = dict(zip(sp["call_id"], sp["recording_url"]))
    pick = pd.DataFrame(rows).sample(min(n, len(rows)), random_state=seed)
    t = pd.DataFrame({"call_id": pick["call_id"], "recording_url": pick["call_id"].map(urls),
                      "human_sentiment_overall": "", "human_call_outcome": "",
                      "human_instructions_followed": "", "human_bot_guidance_score": "", "human_notes": ""})
    out.parent.mkdir(parents=True, exist_ok=True)
    t.to_csv(out, index=False)
    log.info("Wrote %s - listen to these calls and fill in the human_* columns, save as hand_labels.csv", out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--all", action="store_true", help="include transcripts outside the sample")
    ap.add_argument("--out", default=None, help="dashboard data.json path")
    args = ap.parse_args()
    cfg = load_config()

    rows = build_rows(cfg, only_sample=not args.all)
    if not rows:
        raise SystemExit("No analyses found - run: python src/analyze.py")
    summary = summarize(rows)
    pop = population_stats(cfg)

    # ---- flat CSV
    proc = path_of(cfg["paths"]["processed_dir"])
    proc.mkdir(parents=True, exist_ok=True)
    flat = []
    for r in rows:
        x = {k: v for k, v in r.items() if k not in ("transcript", "postprocess_changes")}
        for k in LIST_FIELDS:
            x[k] = "; ".join(x.get(k) or [])
        x["n_postprocess_changes"] = len(r["postprocess_changes"])
        flat.append(x)
    pd.DataFrame(flat).to_csv(proc / "calls_analysis.csv", index=False, encoding="utf-8-sig")
    (proc / "summary.json").write_text(json.dumps(summary, indent=1, ensure_ascii=False), encoding="utf-8")

    # ---- validation results (optional)
    vp = path_of("validation/validation_results.json")
    validation = json.loads(vp.read_text(encoding="utf-8")) if vp.exists() else None

    # ---- dashboard data
    sp = path_of(cfg["paths"]["sample_ids"])
    dates = sorted({r["date_ist"] for r in rows if r["date_ist"]})
    pp_total = sum(len(r["postprocess_changes"]) for r in rows)
    data = {
        "meta": {
            "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "n_calls": len(rows), "dates": dates,
            "sample": {"seed": cfg["sample"]["seed"], "max_duration_sec": cfg["sample"]["max_duration_sec"],
                       "requested": cfg["sample"]["size"]},
            "models": summary["models"], "whisper_model": cfg["groq"]["whisper_model"],
        },
        "population": pop,
        "quality": {"postprocess_overrides": pp_total,
                    "calls_with_overrides": sum(1 for r in rows if r["postprocess_changes"]),
                    "rule_based_calls": summary["models"].get("rule_based", 0),
                    "validation": validation},
        "calls": rows,
    }
    out = Path(args.out) if args.out else path_of("dashboard/public/data.json")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    if sp.exists():
        label_template(rows, cfg)

    print("\n=== Aggregate summary ===")
    print(json.dumps({k: summary[k] for k in (
        "n_calls", "sentiment", "sentiment_known_share_pct", "outcomes", "reached_human_agent_pct",
        "abandoned_before_agent_pct", "median_hold_sec", "hold_share_of_total_call_time_pct",
        "bot_guidance_mean", "instructions_followed_pct", "survey_prompt_reached_pct", "verbal_feedback_calls")},
        indent=1, ensure_ascii=False))
    print("\nWrote:", proc / "calls_analysis.csv", "|", proc / "summary.json", "|", out)


if __name__ == "__main__":
    main()
