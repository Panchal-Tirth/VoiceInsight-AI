"""Phase 3: download the sampled recordings and transcribe them with Groq Whisper.

 * Resumable: a call whose data/transcripts/<id>.json exists is skipped.
 * Quota aware: a usage ledger (data/whisper_usage.csv) tracks audio-seconds sent in the
   last hour / 24 h, and the script waits when the free hourly cap would be exceeded.
   The ledger survives restarts, so rerunning never double-spends the quota.
 * Calls are processed in a seeded random order, so if the run stops early the finished
   calls are still a representative subset.

Run:   python src/transcribe.py            (whole sample)
Test:  python src/transcribe.py --limit 3
"""
import argparse
import csv
import json
import os
import re
import time
from collections import deque
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

import groq
import pandas as pd

from utils import download_file, get_logger, load_config, load_manifest, path_of, save_manifest

log = get_logger("transcribe")

# NO prompt by default. A vocabulary prompt was tested and Whisper echoed it as fake text
# ("पेट पूजा सपोर्ट. Hindi, English, dashboard, ...") over silence and hold music.
DEFAULT_PROMPT = ""
MIN_BILLED_SEC = 10  # Groq bills at least 10 s per request


class DailyLimit(Exception):
    pass


# ------------------------------------------------------------------ quota ledger
class Ledger:
    """Rolling record of audio-seconds sent to Whisper."""

    def __init__(self, path, now=time.time):
        self.path, self.now = Path(path), now
        self.items = deque()
        if self.path.exists():
            with open(self.path, newline="", encoding="utf-8") as f:
                for row in csv.DictReader(f):
                    ts = float(row["ts"])
                    if self.now() - ts < 86400:
                        self.items.append((ts, float(row["billed_sec"])))

    def _used(self, window):
        t = self.now()
        return sum(s for ts, s in self.items if t - ts < window)

    def wait_time(self, sec, hourly, daily):
        """0 = fits now; >0 = seconds to wait for the hourly window; None = daily cap hit."""
        if self._used(86400) + sec > daily:
            return None
        used = self._used(3600)
        if used + sec <= hourly:
            return 0
        t, need, freed = self.now(), used + sec - hourly, 0.0
        for ts, s in sorted(self.items):
            if t - ts < 3600:
                freed += s
                if freed >= need:
                    return max(ts + 3600 - t, 0) + 2
        return 3600

    def add(self, call_id, sec):
        ts = self.now()
        self.items.append((ts, sec))
        new = not self.path.exists()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with open(self.path, "a", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            if new:
                w.writerow(["ts", "call_id", "billed_sec"])
            w.writerow([ts, call_id, sec])


# ------------------------------------------------------------------ Whisper call
def parse_retry_after(e, default=60.0):
    headers = getattr(getattr(e, "response", None), "headers", None) or {}
    ra = headers.get("retry-after")
    if ra:
        try:
            return float(ra)
        except ValueError:
            pass
    m = re.search(r"try again in\s*(?:(\d+)h)?\s*(?:(\d+)m(?!s))?\s*(?:([\d.]+)s)?", str(e))
    if m and any(m.groups()):
        h, mi, s = (float(x) if x else 0.0 for x in m.groups())
        return h * 3600 + mi * 60 + s
    return default


def transcribe_one(client, audio_path, call_id, model, prompt):
    kwargs = dict(model=model, response_format="verbose_json", temperature=0.0)
    if prompt:
        kwargs["prompt"] = prompt
    with open(audio_path, "rb") as f:
        resp = client.audio.transcriptions.create(file=(Path(audio_path).name, f.read()), **kwargs)
    d = resp.model_dump() if hasattr(resp, "model_dump") else dict(resp)
    segs = [{k: s.get(k) for k in ("start", "end", "text", "avg_logprob", "no_speech_prob", "compression_ratio")}
            for s in (d.get("segments") or [])]
    return {
        "call_id": int(call_id),
        "language": d.get("language"),
        "duration_sec": d.get("duration"),
        "text": d.get("text", ""),
        "segments": segs,
        "model": model,
        "transcribed_at": datetime.now(timezone.utc).isoformat(),
    }


# ------------------------------------------------------------------ main flow
def run(sample, client, o, now=time.time, sleep=time.sleep):
    """o = dict of options. Returns (done, failed, stopped_reason)."""
    audio_dir, out_dir = Path(o["audio_dir"]), Path(o["out_dir"])
    out_dir.mkdir(parents=True, exist_ok=True)
    ledger = Ledger(o["ledger_path"], now=now)

    todo = sample[~sample["call_id"].apply(lambda c: (out_dir / f"{int(c)}.json").exists())]
    todo = todo.sample(frac=1, random_state=o["seed"])  # representative if we stop early
    if o.get("limit"):
        todo = todo.head(o["limit"])
    log.info("Sample %d | already transcribed %d | to do %d",
             len(sample), len(sample) - len(todo) if not o.get("limit") else 0, len(todo))

    # 1) download everything first (no rate limit on the audio host)
    def dl(row):
        dest = audio_dir / f"{int(row.call_id)}.mp3"
        ok, msg = download_file(row.recording_url, dest, o["retries"], o["timeout"])
        return int(row.call_id), ok, msg

    failed, ready = {}, []
    with ThreadPoolExecutor(max_workers=o["workers"]) as ex:
        for cid, ok, msg in ex.map(dl, todo.itertuples(index=False)):
            if ok:
                ready.append(cid)
            else:
                failed[cid] = f"download:{msg}"
                log.error("call %s download failed: %s", cid, msg)
    ready_set = set(ready)
    todo = todo[todo["call_id"].isin(ready_set)]
    log.info("Downloaded OK: %d | download failures: %d", len(ready), len(failed))

    # 2) transcribe, respecting the quota
    done, stopped, last_req = 0, None, 0.0
    for r in todo.itertuples(index=False):
        cid = int(r.call_id)
        dur = max(float(r.est_duration_sec), MIN_BILLED_SEC)

        while True:
            w = ledger.wait_time(dur, o["hourly"], o["daily"])
            if w is None:
                stopped = "daily_cap"
                break
            if w <= 0:
                break
            log.info("Hourly quota full - waiting ~%.0f min (call %s, %.0fs audio)", w / 60, cid, dur)
            sleep(min(w, 60))
        if stopped:
            break

        gap = o["min_gap"] - (now() - last_req)
        if gap > 0:
            sleep(gap)

        rec, err = None, None
        for attempt in range(1, o["retries"] + 2):
            try:
                last_req = now()
                rec = transcribe_one(client, audio_dir / f"{cid}.mp3", cid, o["model"], o["prompt"])
                break
            except groq.RateLimitError as e:
                msg = str(e).lower()
                if "per day" in msg or "(asd)" in msg:
                    stopped = "daily_cap"
                    break
                wait = parse_retry_after(e)
                log.warning("429 on call %s (attempt %d) - sleeping %.0fs", cid, attempt, wait + 1)
                sleep(wait + 1)
            except (groq.APIConnectionError, groq.InternalServerError) as e:
                log.warning("transient error on call %s (attempt %d): %s", cid, attempt, type(e).__name__)
                sleep(2 ** attempt * 2)
            except groq.APIStatusError as e:
                err = f"http_{e.status_code}"
                log.error("call %s rejected: %s", cid, e)
                break
        if stopped:
            break
        if rec is None:
            failed[cid] = err or "gave_up_after_retries"
            continue

        (out_dir / f"{cid}.json").write_text(json.dumps(rec, ensure_ascii=False, indent=1), encoding="utf-8")
        ledger.add(cid, max(float(rec.get("duration_sec") or dur), MIN_BILLED_SEC))
        done += 1
        if done % 5 == 0 or done == len(todo):
            log.info("progress: %d / %d transcribed", done, len(todo))
    return done, failed, stopped


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=None, help="only N calls (testing)")
    ap.add_argument("--daily-cap", type=float, default=None, help="override daily audio-sec cap")
    args = ap.parse_args()

    cfg = load_config()
    g = cfg["groq"]
    sample_path = path_of(cfg["paths"]["sample_ids"])
    if not sample_path.exists():
        raise SystemExit("sample_ids.csv not found - run: python src/make_sample.py")
    sample = pd.read_csv(sample_path)

    from dotenv import load_dotenv
    load_dotenv(path_of(".env"))
    key = os.getenv("GROQ_API_KEY")
    if not key or key.startswith("paste_"):
        raise SystemExit("GROQ_API_KEY missing in .env")
    client = groq.Groq(api_key=key, max_retries=0)  # we do our own retry/quota handling

    o = {
        "audio_dir": path_of(cfg["paths"]["audio_dir"]),
        "out_dir": path_of(cfg["paths"]["transcripts_dir"]),
        "ledger_path": path_of("data/whisper_usage.csv"),
        "model": g["whisper_model"],
        "prompt": g.get("whisper_prompt", DEFAULT_PROMPT),
        "hourly": g.get("whisper_hourly_audio_sec", 6800),   # free cap is 7,200
        "daily": args.daily_cap or g.get("whisper_daily_audio_sec", 28000),  # free cap is 28,800
        "min_gap": g.get("whisper_min_gap_sec", 3.5),         # free cap is 20 requests/min
        "workers": cfg["download"]["workers"],
        "retries": cfg["download"]["retries"],
        "timeout": cfg["download"]["timeout_sec"],
        "seed": cfg["sample"]["seed"],
        "limit": args.limit,
    }
    done, failed, stopped = run(sample, client, o)

    # sync results into the manifest
    mpath = path_of(cfg["paths"]["manifest"])
    if mpath.exists():
        m = load_manifest(mpath)
        for f in Path(o["out_dir"]).glob("*.json"):
            j = json.loads(f.read_text(encoding="utf-8"))
            idx = m.index[m["call_id"] == j["call_id"]]
            if len(idx):
                m.loc[idx, "language"] = j.get("language")
                m.loc[idx, "local_path"] = str(Path(o["audio_dir"]) / f"{j['call_id']}.mp3")
        for cid, why in failed.items():
            m.loc[m["call_id"] == cid, "error"] = why
        save_manifest(m, mpath)

    total_done = len(list(Path(o["out_dir"]).glob("*.json")))
    print("\n=== Transcription summary ===")
    print("Transcribed this run :", done)
    print("Transcripts on disk  :", total_done, "/", len(sample), "(incl. any from earlier runs)")
    print("Failed               :", len(failed), failed if failed else "")
    if stopped == "daily_cap":
        print("\nStopped: daily Whisper quota reached. Just rerun this command later - it resumes.")


if __name__ == "__main__":
    main()