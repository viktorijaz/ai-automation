// Private file storage (Supabase Storage); server only, never imported by client components
import "./env";
import { createClient } from "@supabase/supabase-js";

let client: ReturnType<typeof createClient> | null = null;

// Created on first use, so code that never touches files needs no service key
function storage() {
  if (!client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("file storage needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
    client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  return client.storage;
}

// upsert: false, so an existing file is never overwritten
export async function putFile(bucket: string, path: string, bytes: Buffer, contentType: string): Promise<void> {
  const { error } = await storage().from(bucket).upload(path, bytes, { contentType, upsert: false });
  if (error) throw new Error(`upload failed: ${error.message}`);
}

export async function getFile(bucket: string, path: string): Promise<Buffer> {
  const { data, error } = await storage().from(bucket).download(path);
  if (error || !data) throw new Error(`download failed: ${error?.message ?? "no data"}`);
  return Buffer.from(await data.arrayBuffer());
}

// A short-lived link for the browser; the caller checks access first
export async function signedUrl(bucket: string, path: string, seconds: number): Promise<string> {
  const { data, error } = await storage().from(bucket).createSignedUrl(path, seconds);
  if (error || !data) throw new Error(`signed URL failed: ${error?.message ?? "no data"}`);
  return data.signedUrl;
}
