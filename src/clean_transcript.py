"""Phase 3b: turn a raw Whisper transcript into a compact, LLM-ready timeline + numeric features.

Why: a typical call is  bot triage -> HOLD QUEUE (looping announcements) -> human agent -> survey.
The hold loop is repeated text that costs tokens and says nothing about the customer, and Whisper
invents text over silence/music. This step:
  * collapses the repeating hold announcements into one marker,
  * flags low-confidence / looping segments instead of feeding them as fact,
  * computes hold time and "survey prompt reached" deterministically (no LLM needed),
  * caps the text length so a call never blows the LLM token budget.

Pure functions, no network. Used by analyze.py; can also be run alone:
    python src/clean_transcript.py data/transcripts/399553.json
"""
import json
import re
import sys
from difflib import SequenceMatcher
from pathlib import Path

# ---- thresholds (Whisper segment stats are coarse: they are shared across a ~30 s window)
UNCLEAR_LOGPROB = -1.0      # below this the text is treated as noise
WARN_LOGPROB = -0.7         # between WARN and UNCLEAR the text is kept but marked "(?)"
LOOP_COMPRESSION = 2.4      # repeated-token loops ("y y y y y")
REPEAT_SIMILARITY = 0.80    # a line this similar to an earlier long line = a repeat
MIN_REPEAT_CHARS = 25
MIN_ANNOUNCEMENTS = 3       # fewer than this many queue lines => no hold queue
MAX_CHARS = 6000            # LLM input cap (head 60% + tail 40%)

# Queue/IVR announcement phrases (Roman + Devanagari variants, ASR-spelling tolerant)
QUEUE_RE = re.compile(
    r"caller number|currently caller|keep your .{0,25}\bid\b.{0,10}ready|ready so that we can|"
    r"quick help|outlet id|top left corner|left side top|feedback survey|transferred to ivr|transfer your call to ivr|"
    r"apni .{0,20}id ready|id ready rakhe|कॉलर नंबर|आईडी.{0,15}तैयार|फीडबैक सर्वे|क्विक हेल्प",
    re.I)
SURVEY_RE = re.compile(
    r"(one|1|वन)\s+for\s+\w+.{0,20}(zero|0|ज़ीरो|जीरो)\s+for|press\s+1.{0,30}(0|zero)\s+for\s+un|"
    r"1\s+for\s+happy|happy\s+and\s+(0|zero)", re.I)
LOOP_TOKEN_RE = re.compile(r"(\b\S+\b)(\s+\1){5,}", re.I)


def _norm(t: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^\w\s]", "", t.lower())).strip()


def _mmss(sec: float) -> str:
    sec = int(round(sec))
    return f"{sec // 60:02d}:{sec % 60:02d}"


def load_transcript(path) -> dict:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def clean(rec: dict) -> dict:
    """rec = transcript JSON. Returns {call_id, duration_sec, language, features, text}."""
    dur = float(rec.get("duration_sec") or 0)
    segs = [s for s in (rec.get("segments") or []) if (s.get("text") or "").strip()]

    # 1) classify every segment
    seen = []          # normalised long lines seen so far (for repeat detection)
    rows = []
    for s in segs:
        text = s["text"].strip()
        n = _norm(text)
        lp = s.get("avg_logprob")
        cr = s.get("compression_ratio")
        kind = "speech"
        if QUEUE_RE.search(text):
            kind = "announcement"
        elif len(n) >= MIN_REPEAT_CHARS and any(SequenceMatcher(None, n, p).ratio() >= REPEAT_SIMILARITY for p in seen):
            kind = "announcement"
        elif (cr is not None and cr > LOOP_COMPRESSION) or LOOP_TOKEN_RE.search(text):
            kind = "unclear"
        elif lp is not None and lp < UNCLEAR_LOGPROB:
            kind = "unclear"
        elif lp is not None and lp < WARN_LOGPROB:
            kind = "shaky"
        if len(n) >= MIN_REPEAT_CHARS:
            seen.append(n)
        rows.append({"start": float(s["start"]), "end": float(s["end"]), "text": text, "kind": kind})

    # 2) hold window = from first to last queue announcement; EVERYTHING inside it is the queue loop
    ann = [r for r in rows if r["kind"] == "announcement"]
    has_queue = len(ann) >= MIN_ANNOUNCEMENTS
    hold_start = ann[0]["start"] if has_queue else None
    hold_end = ann[-1]["end"] if has_queue else None
    hold_sec = round(hold_end - hold_start, 1) if has_queue else 0.0
    if has_queue:
        for r in rows:
            if r["start"] >= hold_start - 0.5 and r["end"] <= hold_end + 0.5:
                r["kind"] = "hold"

    # 3) survey prompt: only counts AFTER the queue (the queue itself warns about the survey)
    if has_queue:
        tail = [r for r in rows if r["start"] >= hold_end - 1 and r["kind"] != "hold"]
    else:
        tail = rows[-6:]
    survey_reached = any(SURVEY_RE.search(r["text"]) for r in tail)
    queue_abandoned = bool(has_queue and not [r for r in rows if r["kind"] in ("speech", "shaky") and r["start"] >= hold_end - 1])

    # 4) build the compact timeline
    lines, i = [], 0
    while i < len(rows):
        r = rows[i]
        if r["kind"] == "hold":
            j = i
            while j + 1 < len(rows) and rows[j + 1]["kind"] == "hold":
                j += 1
            lines.append(f"[{_mmss(rows[i]['start'])}-{_mmss(rows[j]['end'])}] (HOLD QUEUE: customer waiting, automated announcements looping, "
                         f"~{int(rows[j]['end'] - rows[i]['start'])}s)")
            i = j + 1
        elif r["kind"] == "unclear":
            j = i
            while j + 1 < len(rows) and rows[j + 1]["kind"] == "unclear":
                j += 1
            lines.append(f"[{_mmss(rows[i]['start'])}-{_mmss(rows[j]['end'])}] (unclear audio / noise)")
            i = j + 1
        else:
            mark = "(?) " if r["kind"] == "shaky" else ""
            lines.append(f"[{_mmss(r['start'])}] {mark}{r['text']}")
            i += 1
    text = "\n".join(lines)
    if len(text) > MAX_CHARS:
        head, tail = int(MAX_CHARS * 0.6), int(MAX_CHARS * 0.4)
        text = text[:head] + "\n[... middle of the call omitted for length ...]\n" + text[-tail:]

    speech_sec = sum(r["end"] - r["start"] for r in rows if r["kind"] in ("speech", "shaky"))
    feats = {
        "n_segments": len(rows),
        "has_hold_queue": has_queue,
        "hold_start_sec": hold_start,
        "hold_end_sec": hold_end,
        "hold_sec": hold_sec,
        "survey_prompt_reached": survey_reached,
        "queue_abandoned": queue_abandoned,
        "unclear_share": round(sum(r["end"] - r["start"] for r in rows if r["kind"] == "unclear") / dur, 3) if dur else None,
        "speech_sec_after_hold": round(sum(r["end"] - r["start"] for r in rows
                                           if r["kind"] in ("speech", "shaky") and (hold_end is None or r["start"] >= hold_end - 1)), 1),
        "speech_sec_total": round(speech_sec, 1),
    }
    return {"call_id": rec.get("call_id"), "duration_sec": dur, "language": rec.get("language"),
            "features": feats, "text": text}


if __name__ == "__main__":
    out = clean(load_transcript(sys.argv[1]))
    print(json.dumps(out["features"], indent=1))
    print(f"\n--- compact text ({len(out['text'])} chars) ---\n{out['text']}")
