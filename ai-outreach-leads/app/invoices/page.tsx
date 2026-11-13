// The invoices dashboard: upload one invoice, see every invoice of the org
import Link from "next/link";
import { redirect } from "next/navigation";
import { listInvoices } from "../../invoices/queries";
import { getCurrentOrg } from "../data";
import { Header } from "../header";
import { FlagSummary } from "./flags";
import { InvoiceUpload } from "./forms";

export const dynamic = "force-dynamic"; // always read fresh data
export const maxDuration = 60; // the upload action reads the invoice before answering

const usd = (n: number) => `$${n.toFixed(4)}`;

export default async function InvoicesPage() {
  const org = await getCurrentOrg();
  if (!org || org === "no-org") redirect("/");
  const invoices = await listInvoices(org.orgId);

  return (
    <main>
      <Header org={org} active="invoices" />

      <section>
        <h2>Upload an invoice</h2>
        <p className="muted">PDF, PNG or JPG, up to 4 MB. The fields are read and checked straight away.</p>
        <InvoiceUpload />
      </section>

      <section>
        <h2>Invoices</h2>
        {invoices.length === 0 ? (
          <p className="muted">No invoices yet. Upload one above.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Supplier</th>
                <th>Number</th>
                <th>Date</th>
                <th>Total</th>
                <th>Status</th>
                <th>Flags</th>
                <th>Decision</th>
                <th>Cost</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.id}>
                  <td>
                    <Link href={`/invoices/${inv.id}`}>{inv.fields?.supplier_name ?? inv.file_name}</Link>
                    {inv.fields && <div className="muted small">{inv.file_name}</div>}
                  </td>
                  <td>{inv.fields?.invoice_number ?? "—"}</td>
                  <td>{inv.fields?.invoice_date ?? "—"}</td>
                  <td>{inv.fields?.total != null ? `${inv.fields.total.toLocaleString("en")} ${inv.fields.currency ?? ""}` : "—"}</td>
                  <td>
                    <span className={`badge ${inv.status}`}>{inv.status}</span>
                    {inv.last_error && <div className="muted small">{inv.last_error}</div>}
                  </td>
                  <td><FlagSummary flags={inv.flags} /></td>
                  <td>
                    {inv.decision ? (
                      <span className={`badge ${inv.decision}`}>{inv.decision}</span>
                    ) : inv.status === "done" ? (
                      <span className="muted">waiting</span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td>{usd(inv.cost_usd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
