export type Call = {
  call_id: number; date_ist: string; time_ist: string; hour_ist: number | null; duration_sec: number;
  asr_language: string | null; bot_end_sec: number; bot_end_source: string;
  hold_queue: boolean; hold_start_sec: number | null; hold_end_sec: number | null; hold_sec: number;
  agent_start_sec: number | null; survey_reached: boolean; queue_abandoned: boolean; unclear_share: number | null;
  analysis_model: string; tokens: number | null; postprocess_changes: string[];
  language_chosen: string; query_category: string; customer_bot_attitude: string;
  sentiment_start: string; sentiment_end: string; sentiment_overall: string; sentiment_score: number;
  issue_category: string; resolved: string; feedback_theme: string; call_outcome: string; transcript_quality: string;
  bot_issues: string[]; language_request_honored: boolean | null; instructions_followed: boolean | null;
  reached_human_agent: boolean; verbal_feedback_given: boolean;
  bot_guidance_score: number | null; agent_quality_score: number | null; confidence: number;
  issue_summary: string; feedback_text: string; evidence_sentiment: string; evidence_bot: string;
  missed_instructions: string[]; transcript: string; recording_url?: string;
};

export type Population = {
  total_rows: number; with_recording: number; no_url: number;
  by_day: { date: string; count: number }[]; by_hour: { hour: number; count: number }[];
  duration_buckets?: { label: string; count: number }[]; scanned_calls?: number; median_duration_sec?: number;
  total_audio_hours?: number; under_30s?: number; under_30s_pct?: number; over_15min?: number;
};

export type Validation = { n_labelled: number; fields: Record<string, { n: number; agree: number; agreement_pct: number }> };

export type Data = {
  meta: { generated_at: string; n_calls: number; dates: string[]; models: Record<string, number>; whisper_model: string;
          sample: { seed: number; max_duration_sec: number; requested: number } };
  population: Population | null;
  quality: { postprocess_overrides: number; calls_with_overrides: number; rule_based_calls: number; validation: Validation | null };
  calls: Call[];
};
