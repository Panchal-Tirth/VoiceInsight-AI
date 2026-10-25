"""Phase 2b: draw a stratified sample for deep analysis (Whisper + LLM).

Strata = date x duration bucket, allocated proportionally, so the sample mirrors
the full population. Calls longer than sample.max_duration_sec are excluded
(they would eat the Whisper quota); the count is reported.

Run:  python src/make_sample.py
"""
import argparse

import numpy as np
import pandas as pd

from utils import get_logger, load_config, load_manifest, path_of

log = get_logger("make_sample")

BINS = [0, 30, 120, 300, 1e9]
LABELS = ["<30s", "30s-2m", "2-5m", ">5m"]


def allocate(counts: pd.Series, n: int) -> pd.Series:
    """Largest-remainder proportional allocation of n draws across strata."""
    exact = counts / counts.sum() * n
    base = np.floor(exact).astype(int)
    rest = n - base.sum()
    order = (exact - base).sort_values(ascending=False).index[:rest]
    base.loc[order] += 1
    return np.minimum(base, counts)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--manifest", default=None)
    ap.add_argument("--out", default=None)
    args = ap.parse_args()

    cfg = load_config()
    s = cfg["sample"]
    df = load_manifest(args.manifest or path_of(cfg["paths"]["manifest"]))

    pool = df[(df["status"] == "pending") & df["est_duration_sec"].notna()].copy()
    if pool.empty:
        raise SystemExit("No scanned calls. Run: python src/scan_durations.py")
    pool["est_duration_sec"] = pool["est_duration_sec"].astype(float)
    too_long = pool["est_duration_sec"] > s["max_duration_sec"]
    log.info("Excluding %d calls longer than %ss", int(too_long.sum()), s["max_duration_sec"])
    pool = pool[~too_long]
    pool["bucket"] = pd.cut(pool["est_duration_sec"], bins=BINS, labels=LABELS).astype(str)
    pool["stratum"] = pool["date_ist"].astype(str) + " | " + pool["bucket"]

    n = min(s["size"], len(pool))
    alloc = allocate(pool.groupby("stratum").size(), n)
    parts = [g.sample(int(alloc[k]), random_state=s["seed"]) for k, g in pool.groupby("stratum") if alloc[k] > 0]
    sample = pd.concat(parts).sort_values("datetime_utc")

    cols = ["call_id", "date_ist", "time_ist", "hour_ist", "est_duration_sec", "bucket", "recording_url"]
    out = args.out or path_of(cfg["paths"]["sample_ids"])
    sample[cols].to_csv(out, index=False)

    print("\n=== Sample ===")
    print("Population (eligible):", len(pool), "| Sample:", len(sample), "| Excluded long:", int(too_long.sum()))
    cmp = pd.DataFrame({"population_%": pool["bucket"].value_counts(normalize=True) * 100,
                        "sample_%": sample["bucket"].value_counts(normalize=True) * 100}).reindex(LABELS).round(1)
    print("\nDuration mix:\n", cmp.to_string())
    cmp = pd.DataFrame({"population_%": pool["date_ist"].astype(str).value_counts(normalize=True) * 100,
                        "sample_%": sample["date_ist"].astype(str).value_counts(normalize=True) * 100}).sort_index().round(1)
    print("\nDate mix:\n", cmp.to_string())
    tot = sample["est_duration_sec"].sum()
    print("\nSample audio: %.1f hours (%d sec)" % (tot / 3600, tot))
    print("Whisper free quota is 28,800 audio-sec/day -> about %.1f days of quota" % (tot / 28800))
    print("Saved:", out)


if __name__ == "__main__":
    main()
