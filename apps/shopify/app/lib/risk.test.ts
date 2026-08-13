import { describe, expect, it } from "vitest";
import { computeVerdict, hasEnoughData, toneFromScore, RISK_COLORS } from "./risk";

describe("computeVerdict", () => {
  it("stays grey (insufficient data) until a buyer has resolved orders", () => {
    const v = computeVerdict(0.9, 0);
    expect(v.tone).toBe("unknown");
    expect(v.numeral).toBe("—");
    expect(v.short).toBe("INSUFFICIENT");
  });

  it("shows the score from the first resolved order, low confidence", () => {
    const v = computeVerdict(0.9, 1);
    expect(v.tone).toBe("high");
    expect(v.numeral).toBe("0.90");
    expect(v.short).toBe("HIGH");
    expect(v.confidenceLabel).toBe("◔ LOW CONFIDENCE");
  });

  it("shows confidence once there is real history", () => {
    const v = computeVerdict(0.2, 5);
    expect(v.tone).toBe("safe");
    expect(v.numeral).toBe("0.20");
    expect(v.confidenceLabel).toBe("◐ 70%");
  });

  it("maps score bands to tones", () => {
    expect(toneFromScore(0.44)).toBe("safe");
    expect(toneFromScore(0.45)).toBe("watch");
    expect(toneFromScore(0.66)).toBe("high");
  });
});

describe("hasEnoughData", () => {
  it("requires at least one resolved order", () => {
    expect(hasEnoughData(0)).toBe(false);
    expect(hasEnoughData(null)).toBe(false);
    expect(hasEnoughData(1)).toBe(true);
    expect(hasEnoughData(12)).toBe(true);
  });
});

describe("RISK_COLORS", () => {
  it("has a color for every tone", () => {
    for (const tone of ["safe", "watch", "high", "unknown"] as const) {
      expect(RISK_COLORS[tone]).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });
});
