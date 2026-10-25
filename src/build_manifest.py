"""Phase 0: clean the call-log CSV into data/manifest.csv (one row per call).

Run:  python src/build_manifest.py
"""
import pandas as pd

from utils import get_logger, load_config, path_of

log = get_logger("build_manifest")


def main():
    cfg = load_config()
    raw = pd.read_csv(path_of(cfg["paths"]["raw_csv"]))
    log.info("Loaded %d rows from %s", len(raw), cfg["paths"]["raw_csv"])

    df = pd.DataFrame()
    df["call_id"] = raw["id"]
    # NOTE: the CSV column 'datetime_ist' is actually UTC (ends with 'Z').
    # The 'time' column is the real IST wall-clock time.
    df["datetime_utc"] = pd.to_datetime(raw["datetime_ist"], utc=True, errors="coerce")
    ist = df["datetime_utc"].dt.tz_convert("Asia/Kolkata")
    df["date_ist"] = ist.dt.date.astype("string")
    df["time_ist"] = raw["time"]
    df["hour_ist"] = ist.dt.hour
    df["recording_url"] = raw["recording_url"].astype("string").str.strip()

    # Status: usable only if there is a URL, and it is the first occurrence of that URL
    df["status"] = "pending"
    df.loc[df["recording_url"].isna() | (df["recording_url"] == ""), "status"] = "no_url"
    dup = df["status"].eq("pending") & df.duplicated("recording_url", keep="first")
    df.loc[dup, "status"] = "duplicate_url"

    # Filled in by later phases
    # for col in ["local_path", "size_kb", "duration_sec", "channels", "language", "error"]:
    #     df[col] = pd.NA
    # Filled in by later phases
    df["local_path"] = pd.Series(pd.NA, index=df.index, dtype="string")
    df["size_kb"] = pd.Series(pd.NA, index=df.index, dtype="Float64")
    df["duration_sec"] = pd.Series(pd.NA, index=df.index, dtype="Float64")
    df["channels"] = pd.Series(pd.NA, index=df.index, dtype="Int64")
    df["language"] = pd.Series(pd.NA, index=df.index, dtype="string")
    df["error"] = pd.Series(pd.NA, index=df.index, dtype="string")

    out = path_of(cfg["paths"]["manifest"])
    out.parent.mkdir(parents=True, exist_ok=True)
    df.sort_values("datetime_utc").to_csv(out, index=False)

    print("\n=== Manifest summary ===")
    print("Total rows        :", len(df))
    print(df["status"].value_counts().to_string())
    print("\nCalls per day (IST), usable only:")
    print(df[df["status"] == "pending"].groupby("date_ist").size().to_string())
    print("\nBad timestamps    :", int(df["datetime_utc"].isna().sum()))
    print("Saved to          :", out)


if __name__ == "__main__":
    main()
