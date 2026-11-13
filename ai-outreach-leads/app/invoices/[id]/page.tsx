// One invoice: the document next to what was read, the flags, and the decision
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { fileUrl, getInvoice } from "../../../invoices/queries";
import { getCurrentOrg } from "../../data";
import { Header } from "../../header";
import { FlagList } from "../flags";
import { DecisionForm } from "../forms";

export const dynamic = "force-dynamic";

const FIELDS = [
  ["supplier_name", "Supplier"],
  ["supplier_vat_id", "VAT ID"],
  ["iban", "IBAN"],
  ["invoice_number", "Invoice number"],
  ["invoice_date", "Date"],
  ["due_date", "Due"],
  ["currency", "Currency"],
  ["net", "Net"],
  ["vat", "VAT"],
  ["total", "Total"],
] as const;

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const org = await getCurrentOrg();
  if (!org || org === "no-org") redirect("/");
  const { id } = await params;
  const invoice = await getInvoice(org.orgId, id); // org check: other orgs get "not found"
  if (!invoice) notFound();
  const url = await fileUrl(invoice); // valid for 5 minutes

  const flags = invoice.flags ?? [];
  const fields = invoice.fields;

  return (
    <main className="wide">
      <Header org={org} active="invoices" />
      <p><Link href="/invoices">← All invoices</Link></p>

      <div className="split">
        <section className="document">
          <h2>{invoice.file_name}</h2>
          {!url ? (
            <p className="muted">The file isn't available.</p>
          ) : invoice.file_type === "application/pdf" ? (
            <iframe src={url} title={invoice.file_name} />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt={invoice.file_name} />
          )}
        </section>

        <div>
          <section>
            <h2>Flags</h2>
            {invoice.status === "done" ? (
              <FlagList flags={flags} />
            ) : (
              <p>
                <span className={`badge ${invoice.status}`}>{invoice.status}</span>{" "}
                <span className="muted">{invoice.last_error ?? "Not read yet."}</span>
              </p>
            )}
          </section>

          {fields && (
            <section>
              <h2>What was read</h2>
              <table>
                <tbody>
                  {FIELDS.map(([key, label]) => (
                    <tr key={key}>
                      <th>{label}</th>
                      <td>{fields[key] ?? <span className="muted">not on the invoice</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <h3>Lines</h3>
              <table>
                <thead>
                  <tr>
                    <th>Description</th>
                    <th>Qty</th>
                    <th>Unit price</th>
                    <th>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {fields.lines.map((line, i) => (
                    <tr key={i}>
                      <td>{line.description}</td>
                      <td>{line.quantity}</td>
                      <td>{line.unit_price}</td>
                      <td>{line.amount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="muted small">AI cost for this invoice: ${invoice.cost_usd.toFixed(4)} · attempts: {invoice.attempts}</p>
            </section>
          )}

          {invoice.status === "done" && (
            <section>
              <h2>Decision</h2>
              {invoice.decision ? (
                <p>
                  <span className={`badge ${invoice.decision}`}>{invoice.decision}</span> by {invoice.decided_by} on{" "}
                  {invoice.decided_at?.toISOString().slice(0, 16).replace("T", " ")}
                  {invoice.decision_note && <span className="block">“{invoice.decision_note}”</span>}
                </p>
              ) : (
                <DecisionForm id={invoice.id} hasHighFlag={flags.some((f) => f.severity === "high")} />
              )}
            </section>
          )}
        </div>
      </div>
    </main>
  );
}
