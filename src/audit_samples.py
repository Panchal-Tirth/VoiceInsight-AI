"""Phase 1: download a few recordings and inspect them.

Reports per call: download status, duration, channels (mono/stereo), bitrate,
whether the two channels actually differ, and (with --transcribe) the language
Whisper detects plus the opening text.

Run:  python src/audit_samples.py --transcribe
"""
import argparse
import json
import os
import re
import shutil
import subprocess

import pandas as pd

from utils import download_file, get_logger, load_config, mp3_info, path_of

log = get_logger("audit_samples")


def pick_calls(manifest: pd.DataFrame, n: int) -> pd.DataFrame:
    """One call per date (spread over the export), topped up randomly to n."""
    usable = manifest[manifest["status"] == "pending"]
    per_day = usable.groupby("date_ist", group_keys=False).sample(1, random_state=7)
    chosen = per_day.head(n)
    if len(chosen) < n:
        rest = usable.drop(chosen.index)
        chosen = pd.concat([chosen, rest.sample(n - len(chosen), random_state=7)])
    return chosen


def channels_differ(path) -> str:
    """For stereo files: are left and right actually different?
    Uses ffmpeg if installed. Returns 'yes', 'no (dual mono)', or 'unknown'."""
    if not shutil.which("ffmpeg"):
        return "unknown (ffmpeg not installed)"
    cmd = ["ffmpeg", "-hide_banner", "-i", str(path), "-af",
           "pan=mono|c0=0.5*c0-0.5*c1,volumedetect", "-f", "null", "-"]
    out = subprocess.run(cmd, capture_output=True, text=True).stderr
    m = re.search(r"mean_volume:\s*(-?[\d.]+|-inf) dB", out)
    if not m:
        return "unknown"
    if m.group(1) == "-inf" or float(m.group(1)) < -60:
        return "no (dual mono)"
    return "yes (separate channels)"


def transcribe(path, call_id, cfg):
    from dotenv import load_dotenv
    from groq import Groq

    load_dotenv(path_of(".env"))
    key = os.getenv("GROQ_API_KEY")
    if not key or key.startswith("paste_"):
        return None, "GROQ_API_KEY missing in .env"
    client = Groq(api_key=key)
    with open(path, "rb") as f:
        resp = client.audio.transcriptions.create(
            file=(os.path.basename(path), f.read()),
            model=cfg["groq"]["whisper_model"],
            response_format="verbose_json",
            temperature=0.0,
        )
    d = resp.model_dump() if hasattr(resp, "model_dump") else dict(resp)
    record = {
        "call_id": int(call_id),
        "language": d.get("language"),
        "duration_sec": d.get("duration"),
        "text": d.get("text", ""),
        "segments": d.get("segments", []),
        "model": cfg["groq"]["whisper_model"],
    }
    out = path_of(cfg["paths"]["transcripts_dir"]) / f"{int(call_id)}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8")
    return record, "ok"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--transcribe", action="store_true", help="also run Groq Whisper")
    args = ap.parse_args()

    cfg = load_config()
    manifest_path = path_of(cfg["paths"]["manifest"])
    if not manifest_path.exists():
        raise SystemExit("manifest.csv not found - run: python src/build_manifest.py")
    # manifest = pd.read_csv(manifest_path)
    manifest = pd.read_csv(manifest_path)

    # Explicitly restore the intended column types after CSV loading
    for col in ["local_path", "language", "error"]:
        manifest[col] = manifest[col].astype("string")

    for col in ["size_kb", "duration_sec"]:
        manifest[col] = pd.to_numeric(
            manifest[col], errors="coerce"
        ).astype("Float64")

    manifest["channels"] = pd.to_numeric(
        manifest["channels"], errors="coerce"
    ).astype("Int64")

    picks = pick_calls(manifest, cfg["audit"]["n_calls"])
    rows = []
    for idx, r in picks.iterrows():
        cid = int(r["call_id"])
        dest = path_of(cfg["paths"]["audio_dir"]) / f"{cid}.mp3"
        ok, msg = download_file(r["recording_url"], dest,
                                cfg["download"]["retries"], cfg["download"]["timeout_sec"])
        row = {"call_id": cid, "date_ist": r["date_ist"], "time_ist": r["time_ist"],
               "download": msg}
        if not ok:
            log.error("call %s download failed: %s", cid, msg)
            rows.append(row)
            continue
        try:
            info = mp3_info(dest)
            row.update(info)
            if info["channels"] == 2:
                row["channels_differ"] = channels_differ(dest)
            # manifest.loc[idx, ["local_path", "size_kb", "duration_sec", "channels"]] = [
            #     str(dest), info["size_kb"], info["duration_sec"], info["channels"]]
            manifest.at[idx, "local_path"] = str(dest)
            manifest.at[idx, "size_kb"] = info["size_kb"]
            manifest.at[idx, "duration_sec"] = info["duration_sec"]
            manifest.at[idx, "channels"] = info["channels"]
        except Exception as e:
            row["download"] = f"unreadable_mp3: {type(e).__name__}"
            log.error("call %s unreadable: %s", cid, e)
        if args.transcribe and "duration_sec" in row and row.get("download") != "":
            try:
                rec, tmsg = transcribe(dest, cid, cfg)
                if rec:
                    row["language"] = rec["language"]
                    row["opening_text"] = rec["text"][:300].replace("\n", " ")
                    # manifest.loc[idx, "language"] = rec["language"]
                    manifest.at[idx, "language"] = rec["language"]
                else:
                    row["language"] = tmsg
            except Exception as e:
                row["language"] = f"transcribe_error: {type(e).__name__}: {e}"
                log.error("call %s transcribe failed: %s", cid, e)
        rows.append(row)

    manifest.to_csv(manifest_path, index=False)
    report = pd.DataFrame(rows)
    out = path_of("data/audit_report.csv")
    report.to_csv(out, index=False)

    print("\n=== Audit report ===")
    with pd.option_context("display.max_colwidth", 120, "display.width", 200):
        print(report.drop(columns=["opening_text"], errors="ignore").to_string(index=False))
    if "opening_text" in report:
        print("\n--- Opening text of each call ---")
        for _, r in report.iterrows():
            print(f"[{r['call_id']}] ({r.get('language')}) {r.get('opening_text', '')}")
    print("\nSaved:", out)


if __name__ == "__main__":
    main()
