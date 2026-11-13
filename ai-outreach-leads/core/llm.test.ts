import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { readReply, timeLeftFor } from "./llm";

const Schema = z.object({ supplier_name: z.string() });

// A reply with just this text, as create() returns it
function reply(text: string): Anthropic.Message {
  return { content: [{ type: "text", text }] } as unknown as Anthropic.Message;
}

describe("readReply", () => {
  it("returns null for a cut-off reply (not JSON)", () => {
    expect(readReply(reply('{"supplier_name":"Bright'), Schema)).toBeNull();
  });

  it("returns null for JSON of the wrong shape", () => {
    expect(readReply(reply('{"supplier_name":42}'), Schema)).toBeNull();
  });

  it("returns null when there is no text block", () => {
    expect(readReply({ content: [] } as unknown as Anthropic.Message, Schema)).toBeNull();
  });

  it("returns the object for a good reply", () => {
    expect(readReply(reply('{"supplier_name":"Brightline"}'), Schema)).toEqual({ supplier_name: "Brightline" });
  });
});

describe("timeLeftFor", () => {
  it("starts a 40 s call at the start of a run, not after 15 s", () => {
    vi.spyOn(Date, "now").mockReturnValue(100_000);
    expect(timeLeftFor(100_000, 40_000)).toBe(true); // 0 + 40 + 5 = 45 ≤ 55
    expect(timeLeftFor(85_000, 40_000)).toBe(false); // 15 + 40 + 5 = 60 > 55
    vi.restoreAllMocks();
  });
});
