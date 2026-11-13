// Pure rules for uploads and decisions: no database, no API, easy to test
import type { Flag } from "./checks";
import type { FileType } from "./extract";

export const MAX_BYTES = 4 * 1024 * 1024; // Vercel caps request bodies at ~4.5 MB
export const MAX_NOTE = 1000;

export const EXTENSION: Record<FileType, string> = { "application/pdf": "pdf", "image/png": "png", "image/jpeg": "jpg" };

// The type from the first bytes ("magic numbers"), never from the file name
export function detectType(bytes: Buffer): FileType | null {
  if (bytes.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  return null;
}

// null = the upload is acceptable
export function uploadError(bytes: Buffer): string | null {
  if (bytes.length === 0) return "Choose a file first.";
  if (bytes.length > MAX_BYTES) return `The file is larger than ${MAX_BYTES / 1024 / 1024} MB.`;
  if (!detectType(bytes)) return "Only PDF, PNG or JPG files are accepted.";
  return null;
}

export type Decision = "approved" | "rejected";

// null = the decision may be recorded
export function decisionError(flags: Flag[], decision: Decision, note: string): string | null {
  if (note.length > MAX_NOTE) return `The note is longer than ${MAX_NOTE} characters.`;
  if (decision === "rejected" && note === "") return "Add a note saying why the invoice is rejected.";
  if (decision === "approved" && note === "" && flags.some((f) => f.severity === "high")) {
    return "This invoice has a 🔴 flag: add a note saying how you checked it.";
  }
  return null;
}
