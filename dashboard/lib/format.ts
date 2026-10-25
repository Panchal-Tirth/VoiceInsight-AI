export const fmtDur = (s: number | null | undefined): string => {
  if (s === null || s === undefined || isNaN(s)) return "–";
  const t = Math.round(s);
  if (t < 60) return `${t}s`;
  const m = Math.floor(t / 60), r = t % 60;
  return r ? `${m}m ${r}s` : `${m}m`;
};
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
export const fmtDate = (iso: string): string => {
  const p = iso.split("-");
  if (p.length !== 3) return iso;
  return `${parseInt(p[2], 10)} ${MONTHS[parseInt(p[1], 10) - 1]}`;
};
export const pct = (n: number, d: number, digits = 0): string => (d ? `${((100 * n) / d).toFixed(digits)}%` : "–");
export const num = (n: number): string => n.toLocaleString("en-IN");

export const LABEL: Record<string, Record<string, string>> = {
  sentiment: { positive: "Positive", neutral: "Neutral", negative: "Negative", unknown: "Unclear" },
  outcome: {
    resolved_by_agent: "Resolved by agent", agent_unresolved: "Agent did not resolve", abandoned_in_bot: "Left during bot",
    abandoned_in_queue: "Left in the queue", bot_failure: "Bot failed", unclear: "Unclear",
  },
  issue: {
    printer_setup: "Printer setup", billing_error: "Billing problem", online_orders_integration: "Online orders (Swiggy/Zomato)",
    menu_pricing_setup: "Menu and pricing", inventory: "Inventory", attendance_hr: "Attendance and HR", reports: "Reports",
    login_access: "Login and access", hardware_other: "Other hardware", other: "Other", not_discussed: "No issue reached",
  },
  botIssue: {
    misunderstood_customer: "Misunderstood the customer", repeated_question: "Repeated a question",
    ignored_language_choice: "Ignored the language choice", no_response: "No response", wrong_routing: "Wrong routing",
    abrupt_transfer: "Abrupt transfer", audio_unclear: "Audio unclear", none: "No issue",
  },
  attitude: { engaged: "Answered the bot", reluctant: "Hesitated", asked_for_human: "Asked for a person", hung_up_early: "Hung up early", no_interaction: "Never answered" },
  query: { attendo: "Attendo", inventory: "Inventory", pos_billing: "POS billing", other: "Other", not_captured: "Not captured" },
  language: { hindi: "Hindi", english: "English", other: "Other", none: "Never chose" },
  resolved: { yes: "Resolved", partial: "Partly resolved", no: "Not resolved", unknown: "Unclear" },
  feedbackTheme: {
    praise_agent: "Praised the agent", complaint_wait_time: "Complained about the wait", complaint_bot: "Complained about the bot",
    complaint_agent: "Complained about the agent", product_issue: "Reported a product issue", suggestion: "Made a suggestion",
    thanks_only: "Said thanks", none: "None",
  },
  quality: { good: "Good", fair: "Fair", poor: "Poor" },
};
export const lab = (group: string, key: string): string => LABEL[group]?.[key] ?? key.replace(/_/g, " ");
