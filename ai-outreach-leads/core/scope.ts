// Who a run acts for: one org (a user's button) or every org (cron, CLI); no default on purpose
export type Scope = { orgId: string } | "all-orgs";

// null = no org filter; used as $n in "($n::text IS NULL OR org_id = $n)"
export function orgFilter(scope: Scope): string | null {
  return scope === "all-orgs" ? null : scope.orgId;
}
