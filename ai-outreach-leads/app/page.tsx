// The dashboard: upload, progress, leads (local only until login exists)
import { notFound } from "next/navigation";
import { dashboardEnabled, getLeads, getProgress, ORG_ID } from "./data";
import { ProcessButton, UploadForm } from "./forms";

export const dynamic = "force-dynamic"; // always read fresh data

const usd = (n: number) => `$${n.toFixed(4)}`;

export default async function Home() {
  if (!dashboardEnabled()) notFound();
  const [progress, leads] = await Promise.all([getProgress(ORG_ID), getLeads(ORG_ID)]);
  const { counts } = progress;

  return (
    <main>
      <header>
        <h1>ai-outreach</h1>
        <span className="muted">org: {ORG_ID}</span>
      </header>

      <section>
        <h2>Upload leads</h2>
        <p className="muted">CSV columns: name, company, role, website, note</p>
        <UploadForm />
      </section>

      <section>
        <h2>Progress</h2>
        <div className="stats">
          {(["pending", "processing", "done", "failed"] as const).map((s) => (
            <div key={s} className={`stat ${s}`}>
              <strong>{counts[s]}</strong>
              <span>{s}</span>
            </div>
          ))}
        </div>
        <p>
          Cost: <strong>{usd(progress.totalUsd)}</strong>
          {progress.costs.length > 0 && (
            <span className="muted">
              {" "}({progress.costs.map((c) => `${c.status} ${c.calls}× ${usd(c.usd)}`).join(" · ")})
            </span>
          )}
        </p>
        <ProcessButton />
      </section>

      <section>
        <h2>Leads</h2>
        {leads.length === 0 ? (
          <p className="muted">No leads yet. Upload a CSV above.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Company</th>
                <th>Status</th>
                <th>Email</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((lead) => (
                <tr key={lead.id}>
                  <td>
                    {lead.name}
                    <div className="muted small">{lead.role}</div>
                  </td>
                  <td>{lead.company}</td>
                  <td>
                    <span className={`badge ${lead.status}`}>{lead.status}</span>
                    {lead.attempts > 1 && <div className="muted small">{lead.attempts} attempts</div>}
                  </td>
                  <td>
                    {lead.subject ? (
                      <details>
                        <summary>{lead.subject}</summary>
                        <pre>{lead.body}</pre>
                      </details>
                    ) : (
                      <span className="muted small">{lead.last_error ?? "—"}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
