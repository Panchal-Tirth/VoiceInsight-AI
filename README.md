# VoiceInsight AI: PetPooja Support Call Analysis

Analysis of recorded calls between customers and the PetPooja support voice bot, with a Next.js dashboard.
Built for the PetPooja Data Scientist assignment, Problem 3.

## What it answers

| Question | Where to find it |
|---|---|
| How many calls are positive, and what is each call's sentiment? | Overview, Sentiment & Experience, Call detail |
| Did callers give feedback, and what was it? | Customer Feedback |
| Are callers ready to talk to a voice bot? | Customer Feedback, Sentiment & Experience |
| Does the bot guide callers properly? | Voice Agent Quality |
| Does the bot follow the caller's instructions? | Voice Agent Quality |
| Other insights (waits, drop-offs, recurring issues) | Overview, Insights & Recommendations |

## Pipeline

```
call-log CSV
   -> manifest            (clean rows, flag missing and duplicate links)
   -> duration scan       (file size from HEAD requests, no download)
   -> stratified sample   (date x call-length buckets, seeded)
   -> download audio
   -> Whisper transcription (Groq whisper-large-v3, with timestamps and confidence)
   -> transcript cleaning (collapse hold-queue announcements, flag unclear audio)
   -> LLM analysis        (structured JSON, validated, consistency rules)
   -> aggregate           (one table + dashboard data.json)
   -> Next.js dashboard
   -> hand validation     (optional, 30 calls)
```

### Run it

```bash
pip install -r requirements.txt            # then create .env with GROQ_API_KEY=...
python src/build_manifest.py
python src/scan_durations.py
python src/make_sample.py
python src/transcribe.py                   # resumable, respects Groq free-tier limits
python src/analyze.py                      # resumable, runs cleaning and checks itself
python src/aggregate.py                    # writes dashboard/public/data.json

cd dashboard
npm install
npm run dev                                # http://localhost:3000
```

Hand validation (optional but recommended):

1. Open `validation/hand_labels_template.csv` (30 random calls, links included).
2. Listen to each call and fill the `human_*` columns. Save as `validation/hand_labels.csv`.
3. `python src/validate.py`, then `python src/aggregate.py`. Agreement appears under Settings.

## Data facts

- 10,000 rows; 9,792 have a recording link; 208 have none.
- The CSV column `datetime_ist` is actually UTC. The `time` column is the real IST time.
- Audio is mono, 8 kHz, 32 kbps. Call length is therefore file size / 4000 seconds.
- The full export is about 960 hours of audio. Median call is 263 s; 722 calls are under 15 s; 568 are over 15 min.

## Call structure the analysis relies on

1. Bot greeting and triage: language, then Attendo / Inventory / POS Billing, then "are you in front of your system?".
2. Transfer to the support team.
3. Hold queue with looping announcements.
4. Human agent.
5. Phone-keypad rating prompt ("press 1 happy / 0 unhappy"). The key pressed is not in the audio text.

## Design decisions

- **Sample, not all 9,792 calls.** Free-tier Groq limits (Whisper 7,200 audio-seconds per hour and 28,800 per day; LLM 8K tokens per minute and 200K per day) make the full set impractical in the time available. The final run uses **70 calls**, capped at 600 s, chosen by a seeded stratified sample so it mirrors the export by date and call length. Every stage is resumable and quota-aware, so the same code runs on all calls given more quota.
- **Facts are measured, not guessed.** Hold time, hold window, whether the rating prompt was reached, whether the caller left in the queue, and the share of unclear audio are computed in code from the timed transcript.
- **Interpretations come with evidence.** The LLM returns sentiment, resolution, instruction-following and guidance score, each with a quoted evidence line. Output is schema-validated, then passed through consistency rules (for example, a call that ended in the queue cannot be "resolved by agent").
- **"Unclear" is an answer.** When audio is too noisy, sentiment is reported as unclear rather than forced.
- **No whole-pipeline async workers.** Calls are processed sequentially with a rolling quota ledger, which is simpler and sufficient for free-tier limits.
- **Models.** Whisper large-v3 for speech; `openai/gpt-oss-120b` for analysis, falling back to `gpt-oss-20b`; a rule-based shortcut for calls where only the bot greeting exists.

## Results from the first full aggregate run (70 calls)

| Measure | Value |
|---|---|
| Sentiment | 42 neutral, 5 negative, 0 positive, 23 unclear (67% readable) |
| Reached a human agent | 38.6% |
| Ended before a person picked up | 32.9% |
| Median wait in queue | 94 s (11.9% of all call time) |
| Bot guidance score (1-5) | 3.15 mean |
| Bot did what the caller asked | 72.5% of calls with a request |
| Reached the rating prompt | 2.9% |
| Spoken feedback given | 7 calls |

These are single-run figures on a 70-call sample. Treat them as indicative until the hand check is run.

## Dashboard

Next.js 15, React 19, TypeScript, custom SVG charts, no chart library. Dark-first with a light theme.

| Page | Purpose |
|---|---|
| Overview | KPIs, call volume, sentiment, resolution, language, categories, AI-powered insights, per-call "ribbon" |
| Call Explorer | Searchable, filterable, sortable table with CSV export |
| Call detail (`/calls/<id>`) | Audio player, searchable transcript, AI analysis with evidence |
| Sentiment & Experience | Start vs end sentiment, by day, category and language; customer effort |
| Voice Agent Quality | Guidance score, failure patterns, missed requests, efficiency |
| Customer Feedback | Spoken comments by theme; willingness to talk to a bot |
| Insights & Recommendations | Ranked findings with evidence strength and suggested actions |
| Processing Monitor | Pipeline stage status from real data |
| Settings | Dataset details, methodology, hand-validation results |

Every chart has a table view. Filters apply across pages. No trend arrows are shown because there is no earlier period to compare.

## Known limitations

- **Sentiment is often unclear.** The human-agent part of many calls is noisy Hindi that Whisper transcribes poorly. This is reported, not hidden.
- **Whisper can hallucinate** on hold music and noise. Looping and low-confidence segments are flagged and removed before analysis.
- **Sample size.** 70 of 9,792 calls. Small subgroups (a single category or language) are leads, not conclusions.
- **Rating prompt result is not captured.** The happy/unhappy keypress is not in the audio text. Detecting the keypress tone would be a possible extension.
- **Some hold queues are missed** when the announcement wording differs (for example payroll wording in Hindi after a transfer).
- **Single-channel audio**, so transcript lines are not labelled by speaker.

## Project layout

```
config.yaml             paths, models, sample settings
prompts/                LLM prompt
src/
  build_manifest.py     clean the CSV
  scan_durations.py     call lengths from file size
  make_sample.py        stratified sample
  transcribe.py         Groq Whisper, resumable, quota ledger
  clean_transcript.py   hold/unclear detection, measured features
  schema.py             validation and consistency rules
  analyze.py            LLM analysis
  aggregate.py          table, summary, dashboard data
  validate.py           agreement with hand labels
data/                   manifest, transcripts, analyses, processed outputs
validation/             hand-label sheet and results
dashboard/              Next.js app
```

## Scaling to all calls

Raise `sample.size` (or run `analyze.py --all`), keep the same scripts, and either wait out the daily quotas (the scripts resume) or use a paid tier. Nothing else changes.
