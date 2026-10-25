"""Phase 5b: how often does the LLM agree with a human listener?

1. python src/aggregate.py creates validation/hand_labels_template.csv (30 random calls).
2. Listen to each recording (the URL is in the sheet) and fill the human_* columns:
     human_sentiment_overall      positive | neutral | negative | unknown   (the CUSTOMER)
     human_call_outcome           resolved_by_agent | agent_unresolved | abandoned_in_bot | abandoned_in_queue | bot_failure | unclear
     human_instructions_followed  yes | no | none   (did the bot do what the customer asked?)
     human_bot_guidance_score     1-5
   Save the file as validation/hand_labels.csv.
3. python src/validate.py   -> prints agreement and writes validation/validation_results.json
4. python src/aggregate.py  -> the dashboard now shows these numbers.
"""
import json

import pandas as pd

from utils import load_config, path_of


def main():
    cfg = load_config()
    hp = path_of("validation/hand_labels.csv")
    if not hp.exists():
        raise SystemExit("validation/hand_labels.csv not found - fill in hand_labels_template.csv and save it under that name")
    h = pd.read_csv(hp)
    adir = path_of(cfg["paths"]["analysis_dir"])
    res = {"n_labelled": 0, "fields": {}}
    recs = []
    for _, r in h.iterrows():
        f = adir / f"{int(r['call_id'])}.json"
        if not f.exists():
            continue
        a = json.loads(f.read_text(encoding="utf-8"))["analysis"]
        recs.append((r, a))
    res["n_labelled"] = len(recs)

    def add(name, pairs, tol=None):
        pairs = [(x, y) for x, y in pairs if x is not None and str(x) != "nan" and str(x).strip() != ""]
        if not pairs:
            return
        ok = sum((abs(float(x) - float(y)) <= tol) if tol is not None else (str(x).strip().lower() == str(y).strip().lower())
                 for x, y in pairs)
        res["fields"][name] = {"n": len(pairs), "agree": ok, "agreement_pct": round(100 * ok / len(pairs), 1)}

    add("sentiment_overall", [(r.get("human_sentiment_overall"), a["sentiment_overall"]) for r, a in recs])
    known = [(r.get("human_sentiment_overall"), a["sentiment_overall"]) for r, a in recs
             if str(r.get("human_sentiment_overall")).strip().lower() not in ("unknown", "nan", "") and a["sentiment_overall"] != "unknown"]
    add("sentiment_overall (only where both say known)", known)
    add("call_outcome", [(r.get("human_call_outcome"), a["call_outcome"]) for r, a in recs])
    ymap = {True: "yes", False: "no", None: "none"}
    add("instructions_followed", [(r.get("human_instructions_followed"), ymap[a["instructions_followed"]]) for r, a in recs])
    add("bot_guidance_score (within +/-1)", [(r.get("human_bot_guidance_score"), a["bot_guidance_score"]) for r, a in recs
                                              if a["bot_guidance_score"] is not None], tol=1)
    add("bot_guidance_score (exact)", [(r.get("human_bot_guidance_score"), a["bot_guidance_score"]) for r, a in recs
                                        if a["bot_guidance_score"] is not None], tol=0)

    out = path_of("validation/validation_results.json")
    out.write_text(json.dumps(res, indent=1), encoding="utf-8")
    print(f"\nCalls compared: {res['n_labelled']}")
    for k, v in res["fields"].items():
        print(f"  {k:<48} {v['agree']}/{v['n']} = {v['agreement_pct']}%")
    print("\nSaved:", out)


if __name__ == "__main__":
    main()
