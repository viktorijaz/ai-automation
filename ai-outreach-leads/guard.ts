export type EmailText = { subject: string; body: string };

// Strip < and > so lead data can't break out of its tags
export function clean(value: string): string {
  return value.replace(/[<>]/g, "");
}

// Returns why an email looks attacked, or null if it looks safe
export function findThreat(email: EmailText, canary: string): string | null {
  const text = `${email.subject}\n${email.body}`;

  // We never ask for links, so any link was injected
  if (/https?:\/\/|www\./i.test(text)) return "contains a link";
  if (/\b[a-z0-9-]+\.[a-z]{2,}\/\S*/i.test(text)) return "contains a web address";

  // Signs that the model leaked its instructions
  if (text.includes(canary)) return "leaked the system prompt (canary found)";
  if (/<\/?(lead|note|name|role|company)>/i.test(text)) return "echoed the prompt's tags";
  if (/instructions (i was|you were) given/i.test(text)) return "talks about its instructions";

  return null;
}
