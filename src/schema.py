"""The analysis schema: one flat record per call. Single source of truth for the prompt,
the validator, and the dashboard. Every assignment question maps to one or more fields:

  Positive calls / sentiment per call ... sentiment_start, sentiment_end, sentiment_overall, sentiment_score
  Feedback given, and what ............. verbal_feedback_given, feedback_text, feedback_theme (+ survey_prompt_reached, code-computed)
  Ready to talk to a voice bot? ........ customer_bot_attitude, language_chosen
  Bot guiding the customer properly? ... bot_guidance_score, bot_issues, query_category, call_outcome
  Bot following instructions? .......... instructions_followed, missed_instructions, language_request_honored
  Extras ............................... hold time (code), issue_category, resolved, agent_quality_score
"""

ENUMS = {
    "language_chosen": ["hindi", "english", "other", "none"],
    "query_category": ["attendo", "inventory", "pos_billing", "other", "not_captured"],
    "customer_bot_attitude": ["engaged", "reluctant", "asked_for_human", "hung_up_early", "no_interaction"],
    "sentiment_start": ["positive", "neutral", "negative", "unknown"],
    "sentiment_end": ["positive", "neutral", "negative", "unknown"],
    "sentiment_overall": ["positive", "neutral", "negative", "unknown"],
    "issue_category": ["printer_setup", "billing_error", "online_orders_integration", "menu_pricing_setup",
                       "inventory", "attendance_hr", "reports", "login_access", "hardware_other",
                       "other", "not_discussed"],
    "resolved": ["yes", "partial", "no", "unknown"],
    "feedback_theme": ["praise_agent", "complaint_wait_time", "complaint_bot", "complaint_agent",
                       "product_issue", "suggestion", "thanks_only", "none"],
    "call_outcome": ["resolved_by_agent", "agent_unresolved", "abandoned_in_bot", "abandoned_in_queue",
                     "bot_failure", "unclear"],
    "transcript_quality": ["good", "fair", "poor"],
}
BOT_ISSUES = ["misunderstood_customer", "repeated_question", "ignored_language_choice", "no_response",
              "wrong_routing", "abrupt_transfer", "audio_unclear", "none"]

BOOL_OR_NULL = ["language_request_honored", "instructions_followed"]
BOOLS = ["reached_human_agent", "verbal_feedback_given"]
INT_RANGES = {"bot_guidance_score": (1, 5, True), "agent_quality_score": (1, 5, True),
              "sentiment_score": (-2, 2, False), "confidence": (1, 5, False)}   # (lo, hi, nullable)
STRINGS = {"issue_summary": 160, "feedback_text": 240, "evidence_sentiment": 160, "evidence_bot": 160}
LISTS = {"missed_instructions": 3}

ALL_FIELDS = (list(ENUMS) + ["bot_issues"] + BOOL_OR_NULL + BOOLS + list(INT_RANGES) + list(STRINGS) + list(LISTS))


def _bool(v):
    if isinstance(v, bool):
        return v
    if isinstance(v, str) and v.strip().lower() in ("true", "yes"):
        return True
    if isinstance(v, str) and v.strip().lower() in ("false", "no"):
        return False
    raise ValueError(f"not a boolean: {v!r}")


def validate(d: dict):
    """Returns (clean_record, errors). Fixes harmless things (case, whitespace, clamping lengths),
    reports real problems (missing field, value outside the allowed set)."""
    errors, out = [], {}
    if not isinstance(d, dict):
        return {}, ["top level is not a JSON object"]
    for k, allowed in ENUMS.items():
        v = d.get(k)
        v = v.strip().lower() if isinstance(v, str) else v
        if v in allowed:
            out[k] = v
        else:
            errors.append(f"{k}={v!r} not in {allowed}")
    issues = d.get("bot_issues")
    if isinstance(issues, str):
        issues = [issues]
    if isinstance(issues, list) and issues:
        issues = [str(x).strip().lower() for x in issues]
        bad = [x for x in issues if x not in BOT_ISSUES]
        if bad:
            errors.append(f"bot_issues has invalid values {bad}; allowed {BOT_ISSUES}")
        good = [x for x in issues if x in BOT_ISSUES and x != "none"]
        out["bot_issues"] = good or ["none"]
    else:
        errors.append("bot_issues must be a non-empty list")
    for k in BOOL_OR_NULL:
        v = d.get(k)
        if v is None:
            out[k] = None
        else:
            try:
                out[k] = _bool(v)
            except ValueError as e:
                errors.append(f"{k}: {e}")
    for k in BOOLS:
        try:
            out[k] = _bool(d.get(k))
        except ValueError as e:
            errors.append(f"{k}: {e}")
    for k, (lo, hi, nullable) in INT_RANGES.items():
        v = d.get(k)
        if v is None and nullable:
            out[k] = None
            continue
        try:
            iv = int(round(float(v)))
            if not lo <= iv <= hi:
                raise ValueError
            out[k] = iv
        except (TypeError, ValueError):
            errors.append(f"{k}={v!r} must be an integer {lo}..{hi}" + (" or null" if nullable else ""))
    for k, n in STRINGS.items():
        v = d.get(k)
        out[k] = ("" if v is None else str(v)).strip()[:n]
    for k, n in LISTS.items():
        v = d.get(k)
        if v is None or v == "":
            v = []
        if isinstance(v, str):
            v = [v]
        out[k] = [str(x).strip()[:120] for x in v][:n] if isinstance(v, list) else []
    return out, errors


def rule_based_record(call_outcome, attitude, quality="good", note="") -> dict:
    """Deterministic record for calls that need no LLM (customer never answered the bot)."""
    return {
        "language_chosen": "none", "query_category": "not_captured",
        "customer_bot_attitude": attitude, "sentiment_start": "unknown", "sentiment_end": "unknown",
        "sentiment_overall": "unknown", "issue_category": "not_discussed", "resolved": "unknown",
        "feedback_theme": "none", "call_outcome": call_outcome, "transcript_quality": quality,
        "bot_issues": ["none"], "language_request_honored": None, "instructions_followed": None,
        "reached_human_agent": False, "verbal_feedback_given": False,
        "bot_guidance_score": None, "agent_quality_score": None, "sentiment_score": 0, "confidence": 5,
        "issue_summary": "", "feedback_text": "", "evidence_sentiment": note, "evidence_bot": note,
        "missed_instructions": [],
    }


def postprocess(a: dict, features: dict = None):
    """Deterministic consistency rules applied to a validated record.
    Returns (record, changes) - `changes` lists every override so the report can state how often the LLM contradicted itself."""
    a, ch, features = dict(a), [], features or {}

    def setv(k, v, why):
        if a.get(k) != v:
            ch.append(f"{k}: {a.get(k)!r} -> {v!r} ({why})")
            a[k] = v

    # code-measured facts beat the LLM
    if features.get("queue_abandoned"):
        setv("call_outcome", "abandoned_in_queue", "caller left while in hold queue")
        setv("reached_human_agent", False, "caller left while in hold queue")
    # instruction-following must agree with the issues the model itself listed
    if ("ignored_language_choice" in a["bot_issues"] or a["missed_instructions"]) and a["instructions_followed"] is not False:
        setv("instructions_followed", False, "bot_issues / missed_instructions list an ignored instruction")
    # outcome must agree with `resolved`
    if a["reached_human_agent"] and a["call_outcome"] not in ("bot_failure",):
        want = {"yes": "resolved_by_agent", "partial": "agent_unresolved", "no": "agent_unresolved", "unknown": "unclear"}[a["resolved"]]
        setv("call_outcome", want, f"resolved={a['resolved']}")
    if not a["reached_human_agent"] and a["call_outcome"] in ("resolved_by_agent", "agent_unresolved"):
        setv("call_outcome", "unclear", "no human agent reached")
    # sentiment score must agree with the label
    rng = {"positive": (1, 2), "negative": (-2, -1), "neutral": (0, 0), "unknown": (0, 0)}[a["sentiment_overall"]]
    if not rng[0] <= a["sentiment_score"] <= rng[1]:
        setv("sentiment_score", max(rng[0], min(rng[1], a["sentiment_score"])), f"label={a['sentiment_overall']}")
    # confidence cap
    if a["transcript_quality"] == "poor" and a["confidence"] > 3:
        setv("confidence", 3, "poor transcript quality")
    return a, ch
