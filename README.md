# Voice Call Analysis (PetPooja - Problem 3)

Pipeline: manifest -> audit -> sample -> transcribe -> LLM analysis -> aggregate -> dashboard.

## Setup
```
python -m venv .venv
# Windows: .venv\Scripts\activate      Mac/Linux: source .venv/bin/activate
pip install -r requirements.txt
copy .env.example .env      # (Mac/Linux: cp .env.example .env)  then paste your GROQ_API_KEY
```

## Phase 0 - build the manifest
```
python src/build_manifest.py
```
Cleans the CSV and writes `data/manifest.csv` (one row per call).

## Phase 1 - audit 5 recordings
```
python src/audit_samples.py --transcribe
```
Downloads 5 calls (spread across dates), reports format, duration, channels,
bitrate, and the language Whisper detects. Output: `data/audit_report.csv`.

Every script is resumable: finished work is skipped on rerun.
