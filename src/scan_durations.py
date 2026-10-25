"""Phase 2a: learn every call's file size (hence duration) WITHOUT downloading audio.

Audio is constant 32 kbps, so duration_sec = bytes / 4000.
Resumable: rows that already have size_bytes are skipped. Checkpoints to the manifest.

Run:  python src/scan_durations.py
Test: python src/scan_durations.py --limit 50
"""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed

import pandas as pd
import requests

from utils import HEADERS, get_logger, load_config, load_manifest, path_of, save_manifest

log = get_logger("scan_durations")


def get_size(url: str, timeout: int = 20):
    """Return (size_bytes or None, error or None). HEAD first, ranged GET as fallback."""
    try:
        r = requests.head(url, headers=HEADERS, timeout=timeout, allow_redirects=True)
        if r.status_code == 200 and r.headers.get("Content-Length"):
            return int(r.headers["Content-Length"]), None
        if r.status_code in (403, 404, 410):
            return None, f"http_{r.status_code}"
        # fallback: ask for the first byte, read total from Content-Range
        h = dict(HEADERS, Range="bytes=0-0")
        with requests.get(url, headers=h, timeout=timeout, stream=True) as g:
            cr = g.headers.get("Content-Range", "")
            if g.status_code == 206 and "/" in cr:
                return int(cr.split("/")[-1]), None
            if g.status_code == 200 and g.headers.get("Content-Length"):
                return int(g.headers["Content-Length"]), None
            return None, f"http_{g.status_code}_no_size"
    except Exception as e:
        return None, type(e).__name__


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--manifest", default=None)
    ap.add_argument("--limit", type=int, default=None, help="only scan N calls (testing)")
    args = ap.parse_args()

    cfg = load_config()
    mpath = args.manifest or path_of(cfg["paths"]["manifest"])
    bps = cfg["scan"]["bytes_per_sec"]
    df = load_manifest(mpath)

    todo = df[(df["status"] == "pending") & df["size_bytes"].isna()]
    if args.limit:
        todo = todo.head(args.limit)
    log.info("To scan: %d calls (already done: %d)", len(todo), int(df["size_bytes"].notna().sum()))

    done = 0
    with ThreadPoolExecutor(max_workers=cfg["scan"]["workers"]) as ex:
        futs = {ex.submit(get_size, df.at[i, "recording_url"]): i for i in todo.index}
        for fut in as_completed(futs):
            i = futs[fut]
            size, err = fut.result()
            if size is not None:
                df.at[i, "size_bytes"] = size
                df.at[i, "est_duration_sec"] = round(size / bps, 1)
            else:
                df.at[i, "error"] = err
                if err in ("http_403", "http_404", "http_410"):
                    df.at[i, "status"] = "dead_link"
            done += 1
            if done % cfg["scan"]["checkpoint_every"] == 0:
                save_manifest(df, mpath)
                log.info("checkpoint: %d / %d", done, len(todo))
    save_manifest(df, mpath)

    ok = df["est_duration_sec"].notna()
    print("\n=== Duration scan ===")
    print("Scanned OK       :", int(ok.sum()))
    print("Failed           :", int(((df['status'] == 'pending') & ~ok).sum()))
    print("Dead links       :", int((df["status"] == "dead_link").sum()))
    if ok.any():
        d = df.loc[ok, "est_duration_sec"].astype(float)
        print("\nEstimated duration (sec):")
        print(d.describe(percentiles=[.1, .25, .5, .75, .9, .99]).round(1).to_string())
        bins = [0, 15, 30, 60, 120, 300, 900, 1e9]
        labels = ["<15s", "15-30s", "30-60s", "1-2m", "2-5m", "5-15m", ">15m"]
        print("\nCalls by duration bucket:")
        print(pd.cut(d, bins=bins, labels=labels).value_counts().reindex(labels).to_string())
        print("\nTotal audio (hours): %.1f" % (d.sum() / 3600))
    # sanity check against the exact durations measured in the audit
    chk = df[df["duration_sec"].notna() & df["est_duration_sec"].notna()]
    if len(chk):
        err = (chk["est_duration_sec"].astype(float) - chk["duration_sec"].astype(float)).abs()
        print("\nEstimate vs real duration on audited calls: max error %.1fs" % err.max())


if __name__ == "__main__":
    main()
