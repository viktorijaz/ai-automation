// Flag summary and list, shared by the invoice list and the detail page
import type { Flag } from "../../invoices/checks";

const ICON = { high: "🔴", medium: "🟠", low: "⚪" } as const;

export function FlagSummary({ flags }: { flags: Flag[] | null }) {
  if (!flags) return <span className="muted">—</span>;
  if (flags.length === 0) return <span className="ok">✓</span>;
  return (
    <span>
      {(["high", "medium", "low"] as const)
        .map((s) => [s, flags.filter((f) => f.severity === s).length] as const)
        .filter(([, n]) => n > 0)
        .map(([s, n]) => `${ICON[s]} ${n}`)
        .join(" · ")}
    </span>
  );
}

export function FlagList({ flags }: { flags: Flag[] }) {
  if (flags.length === 0) return <p className="ok">✓ No flags: the checks found nothing.</p>;
  return (
    <ul className="flags">
      {flags.map((f, i) => (
        <li key={i} className={f.severity}>
          {ICON[f.severity]} <strong>{f.check}</strong>: {f.message}
        </li>
      ))}
    </ul>
  );
}
