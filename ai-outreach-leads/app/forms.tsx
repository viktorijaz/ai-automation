"use client";
// The interactive parts: forms that show the server's answer
import { useActionState } from "react";
import { processNow, uploadCsv, type ProcessState, type UploadState } from "./actions";

export function UploadForm() {
  const [state, action, pending] = useActionState<UploadState, FormData>(uploadCsv, null);
  return (
    <form action={action} className="row">
      <input type="file" name="csv" accept=".csv,text/csv" />
      <button type="submit" disabled={pending}>{pending ? "Uploading…" : "Upload"}</button>
      {state && (
        <div className="note">
          {state.message}
          {state.invalid.length > 0 && (
            <ul>
              {state.invalid.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </form>
  );
}

export function ProcessButton() {
  const [state, action, pending] = useActionState<ProcessState>(processNow, null);
  return (
    <form action={action} className="row">
      <button type="submit" disabled={pending}>{pending ? "Processing…" : "Process a batch now"}</button>
      {state && <span className="note">{state}</span>}
    </form>
  );
}
