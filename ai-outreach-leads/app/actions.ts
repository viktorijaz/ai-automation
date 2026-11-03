"use server";
// The two buttons: upload a CSV, process one batch now
import { revalidatePath } from "next/cache";
import { addLeads, parseLeads, processBatch } from "../pipeline";
import { redirect } from "next/navigation";
import { createClient } from "../lib/supabase/server";
import { getCurrentOrg } from "./data";

export type UploadState = { message: string; invalid: string[] } | null;

export async function uploadCsv(_prev: UploadState, form: FormData): Promise<UploadState> {
  const org = await getCurrentOrg();
  if (!org) throw new Error("not logged in");
  const file = form.get("csv");
  if (!(file instanceof File) || file.size === 0) return { message: "Choose a CSV file first.", invalid: [] };

  const { leads, invalid } = parseLeads(await file.text());
  const added = await addLeads(leads, org.orgId);
  revalidatePath("/");
  return {
    message: `${added} new, ${leads.length - added} already known, ${invalid.length} invalid`,
    invalid: invalid.map((bad) => `row ${bad.row}: ${bad.reason}`),
  };
}

export type ProcessState = string | null;

export async function processNow(): Promise<ProcessState> {
  const org = await getCurrentOrg();
  if (!org) throw new Error("not logged in");
  const r = await processBatch(5);
  revalidatePath("/");
  return `claimed ${r.claimed}: ${r.done} done, ${r.failed} failed, ${r.retry} to retry${r.released ? `, ${r.released} released` : ""}`;
}

export async function signOut() {
  await (await createClient()).auth.signOut();
  redirect("/login");
}
