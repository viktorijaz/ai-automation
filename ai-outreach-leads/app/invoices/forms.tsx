"use client";
// The interactive parts of the invoice pages
import { useActionState } from "react";
import { decide, uploadInvoice, type FormState } from "./actions";

export function InvoiceUpload() {
  const [state, action, pending] = useActionState<FormState, FormData>(uploadInvoice, null);
  return (
    <form action={action} className="row">
      <input type="file" name="file" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" />
      <button type="submit" disabled={pending}>{pending ? "Reading the invoice…" : "Upload"}</button>
      {state && <span className="note error">{state.error}</span>}
    </form>
  );
}

export function DecisionForm({ id, hasHighFlag }: { id: string; hasHighFlag: boolean }) {
  const [state, action, pending] = useActionState<FormState, FormData>(decide, null);
  return (
    <form action={action} className="decision">
      <input type="hidden" name="id" value={id} />
      <textarea
        name="note"
        rows={3}
        maxLength={1000}
        placeholder={hasHighFlag ? "Required: how did you check the 🔴 flags? (e.g. called the supplier)" : "Note (required to reject)"}
      />
      <div className="row">
        <button type="submit" name="decision" value="approved" disabled={pending}>Approve</button>
        <button type="submit" name="decision" value="rejected" className="danger" disabled={pending}>Reject</button>
        {state && <span className="note error">{state.error}</span>}
      </div>
    </form>
  );
}
