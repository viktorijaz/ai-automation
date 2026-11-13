"use server";
// Invoice buttons: upload one file, approve or reject one invoice
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createInvoice, decideInvoice, processInvoiceNow } from "../../invoices/intake";
import { getCurrentOrg } from "../data";

export type FormState = { error: string } | null;

export async function uploadInvoice(_prev: FormState, form: FormData): Promise<FormState> {
  const org = await getCurrentOrg();
  if (!org || org === "no-org") throw new Error("not logged in");
  const file = form.get("file");
  if (!(file instanceof File)) return { error: "Choose a file first." };

  const result = await createInvoice(org.orgId, file.name, Buffer.from(await file.arrayBuffer()));
  if (!result.ok) return { error: result.error };
  if (result.needsExtraction) await processInvoiceNow(org.orgId, result.id); // straight away; the cron retries failures
  revalidatePath("/invoices");
  redirect(`/invoices/${result.id}`);
}

export async function decide(_prev: FormState, form: FormData): Promise<FormState> {
  const org = await getCurrentOrg();
  if (!org || org === "no-org") throw new Error("not logged in");
  const id = String(form.get("id") ?? "");
  const choice = form.get("decision");
  if (choice !== "approved" && choice !== "rejected") return { error: "Choose approve or reject." };
  const note = String(form.get("note") ?? "").trim();

  const error = await decideInvoice(org.orgId, id, choice, note, org.email);
  if (error) return { error };
  revalidatePath("/invoices");
  revalidatePath(`/invoices/${id}`);
  return null;
}
