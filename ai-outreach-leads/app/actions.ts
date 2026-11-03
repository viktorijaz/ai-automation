"use server";
// The two buttons: upload a CSV, process one batch now
import { revalidatePath } from "next/cache";
import { addLeads, parseLeads, processBatch } from "../pipeline";
import { dashboardEnabled, ORG_ID } from "./data";

export type UploadState = { message: string; invalid: string[] } | null;

export async function uploadCsv(_prev: UploadState, form: FormData): Promise<UploadState> {
  if (!dashboardEnabled()) throw new Error("dashboard disabled");
  const file = form.get("csv");
  if (!(file instanceof File) || file.size === 0) return { message: "Choose a CSV file first.", invalid: [] };

  const { leads, invalid } = parseLeads(await file.text());
  const added = await addLeads(leads, ORG_ID);
  revalidatePath("/");
  return {
    message: `${added} new, ${leads.length - added} already known, ${invalid.length} invalid`,
    invalid: invalid.map((bad) => `row ${bad.row}: ${bad.reason}`),
  };
}

export type ProcessState = string | null;

export async function processNow(): Promise<ProcessState> {
  if (!dashboardEnabled()) throw new Error("dashboard disabled");
  const r = await processBatch(5);
  revalidatePath("/");
  return `claimed ${r.claimed}: ${r.done} done, ${r.failed} failed, ${r.retry} to retry${r.released ? `, ${r.released} released` : ""}`;
}
