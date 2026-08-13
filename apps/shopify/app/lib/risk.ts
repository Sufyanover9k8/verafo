/**
 * Verdict logic for the embedded admin UI. Mirrors src/lib/risk.ts in the
 * main Verafo app so both surfaces render the same verdict for the same buyer.
 */

export type VerdictTone = "safe" | "watch" | "high" | "unknown";

const MIN_ORDERS = 3;
const MIN_SCORED = 1;

export function hasEnoughData(totalOrders: number | null | undefined): boolean {
  return Math.max(0, Number(totalOrders ?? 0) || 0) >= MIN_SCORED;
}

export function toneFromScore(score: number): Exclude<VerdictTone, "unknown"> {
  if (score < 0.45) return "safe";
  if (score <= 0.65) return "watch";
  return "high";
}

export function confidenceFrom(orders: number): number | null {
  if (orders < MIN_ORDERS) return null;
  if (orders < 10) return 0.7;
  if (orders < 25) return 0.85;
  return 0.95;
}

export interface Verdict {
  tone: VerdictTone;
  label: string;
  short: string;
  numeral: string;
  confidenceLabel: string;
}

export function computeVerdict(
  riskScore: number | null | undefined,
  totalOrders: number | null | undefined,
): Verdict {
  const orders = Math.max(0, Number(totalOrders ?? 0) || 0);
  if (!hasEnoughData(orders)) {
    return {
      tone: "unknown",
      label: "Insufficient data",
      short: "INSUFFICIENT",
      numeral: "—",
      confidenceLabel: "◔ LOW CONFIDENCE",
    };
  }
  const score = Math.max(0, Math.min(1, Number(riskScore ?? 0.5)));
  const tone = toneFromScore(score);
  const confidence = confidenceFrom(orders);
  return {
    tone,
    label: tone === "safe" ? "Low risk" : tone === "watch" ? "Medium risk" : "High risk",
    short: tone === "safe" ? "LOW" : tone === "watch" ? "MED" : "HIGH",
    numeral: score.toFixed(2),
    confidenceLabel: confidence == null ? "◔ LOW CONFIDENCE" : `◐ ${Math.round(confidence * 100)}%`,
  };
}

export const RISK_COLORS: Record<VerdictTone, string> = {
  safe: "#3FBF87",
  watch: "#E0A32E",
  high: "#E05252",
  unknown: "#6B6480",
};
