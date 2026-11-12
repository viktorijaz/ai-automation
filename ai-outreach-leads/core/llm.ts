// One Anthropic client and one price list for every module
import "./env";
import Anthropic from "@anthropic-ai/sdk";

// Quick retries for network blips; longer outages are retried by later runs
export const client = new Anthropic({ maxRetries: 1, timeout: 60_000 });

// $ per 1 MILLION tokens
const PRICES: Record<string, { input: number; output: number }> = {
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
};

// Call at startup: an unknown model fails here, before any call is paid for
export function assertPriced(model: string): void {
  if (!PRICES[model]) throw new Error(`no price for model ${model}`);
}

export function costUsd(model: string, usage: Anthropic.Usage): number {
  assertPriced(model);
  const price = PRICES[model];
  return (usage.input_tokens * price.input + usage.output_tokens * price.output) / 1_000_000;
}
