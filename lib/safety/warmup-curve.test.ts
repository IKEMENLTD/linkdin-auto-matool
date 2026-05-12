import { describe, it, expect } from "vitest";

import {
  getWarmupLimit,
  getWarmupRatio,
  WARMUP_RATIO_DAY_0,
  WARMUP_RATIO_DAY_1_3,
  WARMUP_RATIO_DAY_4_7,
  WARMUP_RATIO_DAY_8_13,
  WARMUP_RATIO_DAY_14_PLUS,
  WARMUP_DAY_MAX,
} from "./warmup-curve";

describe("getWarmupRatio", () => {
  it("Day 0 -> 20%", () => {
    expect(getWarmupRatio(0)).toBe(WARMUP_RATIO_DAY_0);
  });

  it.each([1, 2, 3])("Day %i -> 30%", (d) => {
    expect(getWarmupRatio(d)).toBe(WARMUP_RATIO_DAY_1_3);
  });

  it.each([4, 5, 6, 7])("Day %i -> 60%", (d) => {
    expect(getWarmupRatio(d)).toBe(WARMUP_RATIO_DAY_4_7);
  });

  it.each([8, 9, 10, 11, 12, 13])("Day %i -> 80%", (d) => {
    expect(getWarmupRatio(d)).toBe(WARMUP_RATIO_DAY_8_13);
  });

  it.each([14, 15, 30, 100])("Day %i -> 100%", (d) => {
    expect(getWarmupRatio(d)).toBe(WARMUP_RATIO_DAY_14_PLUS);
  });

  it("constants are in strict ascending order (sanity)", () => {
    expect(WARMUP_RATIO_DAY_0).toBeLessThan(WARMUP_RATIO_DAY_1_3);
    expect(WARMUP_RATIO_DAY_1_3).toBeLessThan(WARMUP_RATIO_DAY_4_7);
    expect(WARMUP_RATIO_DAY_4_7).toBeLessThan(WARMUP_RATIO_DAY_8_13);
    expect(WARMUP_RATIO_DAY_8_13).toBeLessThan(WARMUP_RATIO_DAY_14_PLUS);
    expect(WARMUP_RATIO_DAY_14_PLUS).toBe(1.0);
  });
});

describe("getWarmupLimit (curve x baseDailyLimit=25)", () => {
  const base = 25;

  it("Day 0 (base=25) -> 5 件", () => {
    expect(getWarmupLimit(0, base)).toBe(5);
  });

  it("Day 1 (base=25) -> 7 件 (25*0.3=7.5 -> floor)", () => {
    expect(getWarmupLimit(1, base)).toBe(7);
  });

  it("Day 5 (base=25) -> 15 件", () => {
    expect(getWarmupLimit(5, base)).toBe(15);
  });

  it("Day 10 (base=25) -> 20 件", () => {
    expect(getWarmupLimit(10, base)).toBe(20);
  });

  it("Day 14 (base=25) -> 25 件 (フル稼働)", () => {
    expect(getWarmupLimit(14, base)).toBe(25);
  });

  it("Day 30 (base=25) -> 25 件", () => {
    expect(getWarmupLimit(30, base)).toBe(25);
  });
});

describe("getWarmupLimit edge cases", () => {
  it("warmupDay=-1 は Day 0 扱い", () => {
    expect(getWarmupLimit(-1, 25)).toBe(5);
  });

  it("warmupDay=NaN は Day 0 扱い", () => {
    expect(getWarmupLimit(Number.NaN, 25)).toBe(5);
  });

  it("warmupDay=Infinity は Day 0 扱い (非有限値は保守側)", () => {
    expect(getWarmupLimit(Number.POSITIVE_INFINITY, 25)).toBe(5);
  });

  it("warmupDay=MAX_SAFE_INTEGER は 14+ 扱い", () => {
    expect(getWarmupLimit(Number.MAX_SAFE_INTEGER, 25)).toBe(25);
  });

  it("warmupDay=3.7 は floor で Day 3 扱い", () => {
    expect(getWarmupLimit(3.7, 25)).toBe(7);
  });

  it("baseDailyLimit=0 は常に 0", () => {
    expect(getWarmupLimit(14, 0)).toBe(0);
    expect(getWarmupLimit(0, 0)).toBe(0);
  });

  it("baseDailyLimit=-5 は 0 (送信不可)", () => {
    expect(getWarmupLimit(14, -5)).toBe(0);
  });

  it("baseDailyLimit=NaN は 0", () => {
    expect(getWarmupLimit(14, Number.NaN)).toBe(0);
  });

  it("baseDailyLimit=Infinity は 0", () => {
    expect(getWarmupLimit(14, Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("WARMUP_DAY_MAX 定数が 14 であること", () => {
    expect(WARMUP_DAY_MAX).toBe(14);
  });

  it("境界 Day 3->4 で 30% -> 60% にジャンプ", () => {
    expect(getWarmupLimit(3, 100)).toBe(30);
    expect(getWarmupLimit(4, 100)).toBe(60);
  });

  it("境界 Day 7->8 で 60% -> 80% にジャンプ", () => {
    expect(getWarmupLimit(7, 100)).toBe(60);
    expect(getWarmupLimit(8, 100)).toBe(80);
  });

  it("境界 Day 13->14 で 80% -> 100% にジャンプ", () => {
    expect(getWarmupLimit(13, 100)).toBe(80);
    expect(getWarmupLimit(14, 100)).toBe(100);
  });
});
