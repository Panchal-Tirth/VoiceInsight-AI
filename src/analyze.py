"""Phase 4: LLM analysis of every transcript -> data/analysis/<call_id>.json

  transcript JSON --clean_transcript--> compact text + measured features --Groq LLM--> validated record

 * Resumable: calls with an existing analysis file are skipped.
 * Quota aware: a token ledger (data/llm_usage.csv) tracks tokens per model per minute / per day
   (free tier: 8K/min, 200K/day) and waits or falls back to the next model.
 * Strict: the model's JSON is validated against schema.py; invalid output gets ONE repair retry,
   then the call is logged to data/analysis_failures.jsonl and retried on the next run.
 * Calls where the customer never answered the bot are filled in by rules (no tokens spent).

Run:   python src/analyze.py
Test:  python src/analyze.py --limit 3
"""
import argparse
import csv
import json
import os
import re
import time
from collections import deque
from datetime import datetime, timezone
from pathlib import Path

import groq
import pandas as pd

from clean_transcript import clean, load_transcript
from schema import postprocess, rule_based_record, validate
from transcribe import parse_retry_after
from utils import get_logger, load_config, path_of

log = get_logger("analyze")

DEFAULT_LIMITS = {"tpm": 7000, "tpd": 190000}   # free tier is 8,000 / 200,000: keep a margin
PREFERRED_MAX_WAIT = 65                          # always wait for the primary model (max one minute); fall back only when its daily budget is gone, so scoring stays consistent
OUTPUT_RESERVE = 900                             # tokens reserved for the answer (+ reasoning)


# ------------------------------------------------------------------ token ledger
class TokenLedger:
    def __init__(self, path, now=time.time):
        self.path, self.now = Path(path), now
        self.items = {}
        if self.path.exists():
            with open(self.path, newline="", encoding="utf-8") as f:
                for row in csv.DictReader(f):
                    ts = float(row["ts"])
                    if self.now() - ts < 86400:
                        self.items.setdefault(row["model"], deque()).append((ts, float(row["tokens"])))

    def used(self, model, window):
        t = self.now()
        return sum(k for ts, k in self.items.get(model, ()) if t - ts < window)

    def wait(self, model, est, tpm, tpd):
        """None = daily budget exhausted; 0 = fits now; else seconds to wait."""
        est = min(est, tpm)
        if self.used(model, 86400) + est > tpd:
            return None
        used = self.used(model, 60)
        if used + est <= tpm:
            return 0
        t, need, freed = self.now(), used + est - tpm, 0.0
        for ts, k in sorted(self.items.get(model, ())):
            if t - ts < 60:
                freed += k
                if freed >= need:
                    return max(ts + 60 - t, 0) + 1
        return 61

    def add(self, model, tokens, call_id):
        ts = self.now()
        self.items.setdefault(model, deque()).append((ts, float(tokens)))
        new = not self.path.exists()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with open(self.path, "a", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            if new:
                w.writerow(["ts", "model", "call_id", "tokens"])
            w.writerow([ts, model, call_id, tokens])


def pick_model(models, ledger, est, limits, exhausted):
    """Primary model unless it would make us wait long; then the best available fallback."""
    waits = []
    for m in models:
        if m in exhausted:
            continue
        lim = {**DEFAULT_LIMITS, **limits.get(m, {})}
        w = ledger.wait(m, est, lim["tpm"], lim["tpd"])
        if w is not None:
            waits.append((m, w))
    if not waits:
        return None
    for m, w in waits:                      # models are in preference order
        if w <= PREFERRED_MAX_WAIT:
            return m, w
    return min(waits, key=lambda x: x[1])


# ------------------------------------------------------------------ prompt + parsing
def mmss(sec):
    sec = int(sec or 0)
    return f"{sec // 60}:{sec % 60:02d}"


def build_user_message(c):
    f = c["features"]
    return (f"call_id: {c['call_id']}\nduration: {mmss(c['duration_sec'])}\nASR language tag: {c['language']}\n"
            f"FEATURES (measured by code): hold_queue_detected={f['has_hold_queue']}, hold_seconds={f['hold_sec']}, "
            f"survey_prompt_reached={f['survey_prompt_reached']}, abandoned_while_in_queue={f['queue_abandoned']}, "
            f"share_of_call_unclear={f['unclear_share']}\n\nTRANSCRIPT:\n{c['text']}\n\nReturn the JSON object now.")


def extract_json(text):
    text = re.sub(r"<think>.*?</think>", "", text or "", flags=re.S).strip()
    m = re.search(r"\{.*\}", text, re.S)
    if not m:
        raise ValueError("no JSON object found in reply")
    return json.loads(m.group(0))


def rule_based(c):
    """Customer never really answered the bot -> no LLM needed."""
    n_lines = c["text"].count("\n") + 1 if c["text"].strip() else 0
    if n_lines == 0:
        return rule_based_record("unclear", "no_interaction", "poor", "empty transcript")
    if n_lines <= 1 and len(c["text"]) < 150 and c["duration_sec"] < 40:
        return rule_based_record("abandoned_in_bot", "hung_up_early", "good",
                                 "only the bot greeting; caller hung up before answering")
    return None


def llm_call(client, model, messages):
    # reasoning_effort / max_completion_tokens go through extra_body so older SDK versions also work
    extra = {"max_completion_tokens": 2000}
    if model.startswith("openai/gpt-oss"):
        extra["reasoning_effort"] = "low"
    resp = client.chat.completions.create(model=model, messages=messages, temperature=0,
                                          response_format={"type": "json_object"}, extra_body=extra)
    u = getattr(resp, "usage", None)
    return (resp.choices[0].message.content or "",
            getattr(u, "total_tokens", None), getattr(u, "prompt_tokens", None))


# ------------------------------------------------------------------ main flow
def run(items, client, o, now=time.time, sleep=time.sleep):
    out_dir = Path(o["out_dir"])
    out_dir.mkdir(parents=True, exist_ok=True)
    ledger = TokenLedger(o["ledger_path"], now=now)
    system = Path(o["prompt_path"]).read_text(encoding="utf-8")
    state = {"exhausted": set(), "tok_per_char": 0.5}
    done, failed, by_model, stopped = 0, {}, {}, None

    todo = [(cid, rec) for cid, rec in items if not (out_dir / f"{cid}.json").exists()]
    if o.get("limit"):
        todo = todo[: o["limit"]]
    log.info("To analyse: %d (already done: %d)", len(todo), len(items) - len(todo))

    for cid, rec in todo:
        c = clean(rec)
        features = c["features"]
        base = {"call_id": cid, "features": features, "duration_sec": c["duration_sec"],
                "asr_language": c["language"], "analyzed_at": datetime.now(timezone.utc).isoformat()}

        rb = rule_based(c)
        if rb is not None:
            (out_dir / f"{cid}.json").write_text(json.dumps({**base, "model": "rule_based", "analysis": rb},
                                                            ensure_ascii=False, indent=1), encoding="utf-8")
            by_model["rule_based"] = by_model.get("rule_based", 0) + 1
            done += 1
            continue

        user = build_user_message(c)
        messages = [{"role": "system", "content": system}, {"role": "user", "content": user}]
        est = (len(system) + len(user)) * state["tok_per_char"] + OUTPUT_RESERVE

        analysis, errs, model_used, tokens_total = None, ["not attempted"], None, 0
        for round_no in (1, 2):                        # round 2 = repair retry
            reply = None
            for attempt in range(1, o["retries"] + 2):
                while True:
                    pick = pick_model(o["models"], ledger, est, o["limits"], state["exhausted"])
                    if pick is None:
                        stopped = "daily_cap"
                        break
                    model, w = pick
                    if w <= 0:
                        break
                    log.info("token quota: waiting %.0fs for %s (call %s)", w, model, cid)
                    sleep(min(w, 30))
                if stopped:
                    break
                try:
                    reply, total, prompt_toks = llm_call(client, model, messages)
                    used = total or est
                    ledger.add(model, used, cid)
                    tokens_total += used
                    model_used = model
                    if prompt_toks:
                        chars = len(system) + len(user)
                        state["tok_per_char"] = 0.7 * state["tok_per_char"] + 0.3 * (prompt_toks / chars)
                    break
                except groq.RateLimitError as e:
                    msg = str(e).lower()
                    if "per day" in msg or "(tpd)" in msg:
                        log.warning("%s hit its DAILY limit - switching model", model)
                        state["exhausted"].add(model)
                        continue
                    wait = parse_retry_after(e)
                    log.warning("429 on %s (call %s) - sleeping %.0fs", model, cid, wait + 1)
                    sleep(wait + 1)
                except (groq.APIConnectionError, groq.InternalServerError) as e:
                    log.warning("transient error on call %s: %s", cid, type(e).__name__)
                    sleep(2 ** attempt * 2)
                except groq.APIStatusError as e:
                    reply, errs = None, [f"http_{e.status_code}: {str(e)[:150]}"]
                    break
            if stopped:
                break
            if reply is None:
                if round_no == 1 and errs and errs[0].startswith("http_400"):
                    messages = messages + [{"role": "user", "content":
                                            "Your previous output could not be parsed as JSON. Return ONLY one valid JSON object."}]
                    continue
                break
            try:
                analysis, errs = validate(extract_json(reply))
            except (ValueError, json.JSONDecodeError) as e:
                analysis, errs = None, [f"unparseable: {e}"]
            if analysis is not None and not errs:
                break
            if round_no == 1:
                messages = messages + [{"role": "assistant", "content": reply[:3000]},
                                       {"role": "user", "content": "That JSON had these problems: "
                                        + "; ".join(errs)[:900] + ". Return the full corrected JSON object only."}]
        if stopped:
            break
        if analysis is None or errs:
            failed[cid] = "; ".join(errs)[:200]
            with open(o["failures_path"], "a", encoding="utf-8") as f:
                f.write(json.dumps({"call_id": cid, "errors": errs, "last_reply": (reply or "")[:2000]}, ensure_ascii=False) + "\n")
            log.error("call %s failed validation: %s", cid, failed[cid])
            continue

        analysis, changes = postprocess(analysis, features)
        (out_dir / f"{cid}.json").write_text(json.dumps({**base, "model": model_used, "tokens": tokens_total,
                                                         "analysis": analysis, "postprocess_changes": changes},
                                                        ensure_ascii=False, indent=1), encoding="utf-8")
        by_model[model_used] = by_model.get(model_used, 0) + 1
        done += 1
        if done % 5 == 0:
            log.info("progress: %d analysed", done)
    return done, failed, by_model, stopped


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--all", action="store_true", help="analyse every transcript, not just the sample")
    args = ap.parse_args()

    cfg = load_config()
    g = cfg["groq"]
    tdir = path_of(cfg["paths"]["transcripts_dir"])
    ids = None
    sp = path_of(cfg["paths"]["sample_ids"])
    if sp.exists() and not args.all:
        ids = set(pd.read_csv(sp)["call_id"].astype(int))
    items = []
    for f in sorted(tdir.glob("*.json")):
        rec = load_transcript(f)
        if ids is None or int(rec["call_id"]) in ids:
            items.append((int(rec["call_id"]), rec))
    if not items:
        raise SystemExit("No transcripts found - run transcribe.py first")

    from dotenv import load_dotenv
    load_dotenv(path_of(".env"))
    key = os.getenv("GROQ_API_KEY")
    if not key or key.startswith("paste_"):
        raise SystemExit("GROQ_API_KEY missing in .env")
    client = groq.Groq(api_key=key, max_retries=0)

    o = {
        "out_dir": path_of(cfg["paths"]["analysis_dir"]),
        "ledger_path": path_of("data/llm_usage.csv"),
        "failures_path": path_of("data/analysis_failures.jsonl"),
        "prompt_path": path_of("prompts/call_analysis.txt"),
        "models": [g["analysis_model"]] + list(g.get("fallback_models", [])),
        "limits": g.get("llm_limits", {}),
        "retries": cfg["download"]["retries"],
        "limit": args.limit,
    }
    done, failed, by_model, stopped = run(items, client, o)
    total = len(list(Path(o["out_dir"]).glob("*.json")))
    print("\n=== Analysis summary ===")
    print("Analysed this run :", done, by_model)
    print("Analyses on disk  :", total, "/", len(items))
    print("Failed validation :", len(failed), failed if failed else "")
    if stopped == "daily_cap":
        print("\nStopped: daily token budget used on all models. Rerun later - it resumes.")


if __name__ == "__main__":
    main()
