// What a user may see about an error: a plain reason. The details go to the server log only.
import Anthropic from "@anthropic-ai/sdk";
import { isTemporary } from "./llm";

export function publicError(e: unknown, context: string): string {
  console.error(`${context}:`, e); // full error, stack included, for Vercel logs
  if (e instanceof Anthropic.APIConnectionTimeoutError) return "the AI took too long";
  if (isTemporary(e)) return "the AI service was busy";
  return "something went wrong on our side";
}
