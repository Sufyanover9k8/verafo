import { computeVerdict, RISK_COLORS } from "../lib/risk";

export function RiskBadge({
  riskScore,
  totalOrders,
}: {
  riskScore: number | null | undefined;
  totalOrders: number | null | undefined;
}) {
  const verdict = computeVerdict(riskScore, totalOrders);
  return (
    <span style={{ color: RISK_COLORS[verdict.tone], whiteSpace: "nowrap" }}>
      <strong>
        {verdict.numeral === "—" ? verdict.short : `${verdict.numeral} ${verdict.short}`}
      </strong>
      <span style={{ opacity: 0.65, marginLeft: "0.4em", fontSize: "0.9em" }}>
        {verdict.confidenceLabel}
      </span>
    </span>
  );
}

const STATUS_COLORS: Record<string, string> = {
  accepted: "#3FBF87",
  refused: "#E05252",
  pending: "#E0A32E",
};

export function StatusPill({
  status,
}: {
  status: string | null | undefined;
}) {
  const s = status ?? "pending";
  return (
    <span
      style={{
        color: STATUS_COLORS[s] ?? "#6B6480",
        textTransform: "uppercase",
        fontWeight: 600,
        fontSize: "0.85em",
        letterSpacing: "0.02em",
      }}
    >
      {s}
    </span>
  );
}

export function formatPhone(p: string | null | undefined): string {
  if (!p) return "—";
  let digits = p.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) digits = digits.slice(1);
  if (digits.startsWith("92") && digits.length >= 11) digits = "0" + digits.slice(2);
  const groups = [4, 3, 4];
  let out = "";
  let i = 0;
  for (const g of groups) {
    if (i >= digits.length) break;
    out += (out ? " " : "") + digits.slice(i, i + g);
    i += g;
  }
  if (i < digits.length) out += " " + digits.slice(i);
  return out;
}
