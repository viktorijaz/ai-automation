// The top bar on every page: app name, Leads | Invoices, who is signed in
import Link from "next/link";
import { signOut } from "./actions";
import type { CurrentOrg } from "./data";

export function Header({ org, active }: { org: CurrentOrg; active: "leads" | "invoices" }) {
  return (
    <header>
      <div className="row">
        <h1>ai-outreach</h1>
        <nav className="row">
          <Link href="/" className={active === "leads" ? "active" : ""}>Leads</Link>
          <Link href="/invoices" className={active === "invoices" ? "active" : ""}>Invoices</Link>
        </nav>
      </div>
      <form action={signOut} className="row">
        <span className="muted">{org.email} · org: {org.orgId}</span>
        {process.env.DASHBOARD_ENABLED !== "true" && <button className="secondary">Sign out</button>}
      </form>
    </header>
  );
}
