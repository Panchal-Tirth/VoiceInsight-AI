"""Shared helpers: config, logging, resilient download, mp3 inspection."""
import logging
import time
from pathlib import Path

import requests
import yaml

ROOT = Path(__file__).resolve().parent.parent  # project root, independent of cwd

HEADERS = {"User-Agent": "Mozilla/5.0 (voice-call-analysis)"}


def load_config() -> dict:
    with open(ROOT / "config.yaml", "r", encoding="utf-8") as f:
        return yaml.safe_load(f)


def path_of(rel: str) -> Path:
    """Resolve a config path (relative to project root)."""
    return ROOT / rel


def get_logger(name: str, logs_dir: str = "logs") -> logging.Logger:
    log_dir = path_of(logs_dir)
    log_dir.mkdir(parents=True, exist_ok=True)
    logger = logging.getLogger(name)
    if logger.handlers:
        return logger
    logger.setLevel(logging.INFO)
    fmt = logging.Formatter("%(asctime)s | %(levelname)s | %(message)s")
    fh = logging.FileHandler(log_dir / f"{name}.log", encoding="utf-8")
    fh.setFormatter(fmt)
    sh = logging.StreamHandler()
    sh.setFormatter(fmt)
    logger.addHandler(fh)
    logger.addHandler(sh)
    return logger


def looks_like_mp3(first_bytes: bytes) -> bool:
    """ID3 tag, or an MPEG frame sync (0xFF 0xEx)."""
    if first_bytes[:3] == b"ID3":
        return True
    return len(first_bytes) >= 2 and first_bytes[0] == 0xFF and (first_bytes[1] & 0xE0) == 0xE0


def download_file(url: str, dest: Path, retries: int = 3, timeout: int = 60):
    """Download url -> dest. Skips if dest already exists and is non-empty.

    Returns (ok: bool, message: str). Never raises.
    """
    dest = Path(dest)
    if dest.exists() and dest.stat().st_size > 0:
        return True, "already_downloaded"
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    last_err = "unknown"
    for attempt in range(1, retries + 1):
        try:
            with requests.get(url, headers=HEADERS, stream=True, timeout=timeout) as r:
                if r.status_code != 200:
                    last_err = f"http_{r.status_code}"
                    if r.status_code in (403, 404, 410):
                        break  # retrying will not help
                    raise RuntimeError(last_err)
                first = b""
                with open(tmp, "wb") as f:
                    for chunk in r.iter_content(chunk_size=1 << 16):
                        if not first:
                            first = chunk[:16]
                        f.write(chunk)
            if tmp.stat().st_size == 0:
                last_err = "empty_file"
                raise RuntimeError(last_err)
            if not looks_like_mp3(first):
                last_err = "not_mp3_content"
                tmp.unlink(missing_ok=True)
                break
            tmp.replace(dest)
            return True, "ok"
        except Exception as e:  # network errors, timeouts, etc.
            last_err = last_err if last_err != "unknown" else type(e).__name__
            time.sleep(2 ** attempt)  # backoff
    tmp.unlink(missing_ok=True)
    return False, last_err


def mp3_info(path: Path) -> dict:
    """Duration, channels, bitrate, sample rate from the mp3 header (no ffmpeg needed)."""
    from mutagen.mp3 import MP3

    audio = MP3(str(path))
    mode_names = {0: "stereo", 1: "joint_stereo", 2: "dual_channel", 3: "mono"}
    return {
        "duration_sec": round(audio.info.length, 2),
        "channels": audio.info.channels,
        "channel_mode": mode_names.get(getattr(audio.info, "mode", None), "unknown"),
        "bitrate_kbps": int(audio.info.bitrate / 1000),
        "sample_rate_hz": audio.info.sample_rate,
        "size_kb": round(Path(path).stat().st_size / 1024, 1),
    }


# ---------------------------------------------------------------- manifest I/O
# CSV round-trips turn all-empty columns into float64, which then reject text.
# Always load/save the manifest through these two helpers.
_TEXT_COLS = ["local_path", "language", "error"]
_FLOAT_COLS = ["size_kb", "duration_sec", "est_duration_sec"]
_INT_COLS = ["channels", "size_bytes"]


def load_manifest(path):
    import pandas as pd

    df = pd.read_csv(path)
    for c in _TEXT_COLS:
        df[c] = df[c].astype("string") if c in df else pd.Series(pd.NA, index=df.index, dtype="string")
    for c in _FLOAT_COLS:
        df[c] = pd.to_numeric(df[c], errors="coerce").astype("Float64") if c in df else pd.Series(pd.NA, index=df.index, dtype="Float64")
    for c in _INT_COLS:
        df[c] = pd.to_numeric(df[c], errors="coerce").astype("Int64") if c in df else pd.Series(pd.NA, index=df.index, dtype="Int64")
    return df


def save_manifest(df, path):
    """Atomic write so a crash mid-save cannot corrupt the manifest."""
    path = Path(path)
    tmp = path.with_suffix(".tmp")
    df.to_csv(tmp, index=False)
    tmp.replace(path)
