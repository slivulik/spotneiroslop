import { describe, expect, it } from "vitest";
import { contrastRatio, parseColor, toArgbHex } from "../src/color.ts";
import { flattenTokens, generateCss } from "../src/generators/css.ts";
import { generateKotlin, pascal } from "../src/generators/kotlin.ts";
import { generateTailwindTheme } from "../src/generators/tailwind.ts";
import { loadTokens, validateTokens } from "../src/load.ts";

const tokens = loadTokens(new URL("../tokens.json", import.meta.url));

describe("color", () => {
  it("parses hex and rgba", () => {
    expect(parseColor("#0B0B0F")).toEqual({ r: 11, g: 11, b: 15, a: 1 });
    expect(parseColor("rgba(255, 77, 109, 0.16)")).toEqual({ r: 255, g: 77, b: 109, a: 0.16 });
    expect(parseColor("#FFFFFF80").a).toBeCloseTo(128 / 255);
  });

  it("rejects unsupported and out-of-range colours", () => {
    expect(() => parseColor("red")).toThrow(/Unsupported/);
    expect(() => parseColor("rgb(300, 0, 0)")).toThrow(/out of range/);
  });

  it("formats ARGB for Android", () => {
    expect(toArgbHex(parseColor("#0B0B0F"))).toBe("0xFF0B0B0F");
    expect(toArgbHex(parseColor("rgba(255, 255, 255, 0.10)"))).toBe("0x1AFFFFFF");
  });
});

describe("accessibility", () => {
  const bg = parseColor(tokens.color.bg!.base!);
  it("primary and secondary text meet WCAG AA on the base background", () => {
    expect(contrastRatio(parseColor(tokens.color.text!.primary!), bg)).toBeGreaterThanOrEqual(7);
    expect(contrastRatio(parseColor(tokens.color.text!.secondary!), bg)).toBeGreaterThanOrEqual(4.5);
  });
  it("accent is usable for large text / icons (3:1)", () => {
    expect(contrastRatio(parseColor(tokens.color.accent!.default!), bg)).toBeGreaterThanOrEqual(3);
  });
});

describe("validation", () => {
  const clone = (): Record<string, unknown> => JSON.parse(JSON.stringify(tokens)) as Record<string, unknown>;

  it("accepts the shipped tokens", () => {
    expect(() => validateTokens(clone())).not.toThrow();
  });

  it("reports the exact path of a broken colour", () => {
    const raw = clone() as { color: { bg: { base: string } } };
    raw.color.bg.base = "nope";
    expect(() => validateTokens(raw)).toThrow("color.bg.base");
  });

  it("rejects non kebab-case names and invalid easings", () => {
    const raw = clone() as { radius: Record<string, number>; motion: { easing: Record<string, number[]> } };
    raw.radius.Big = 3;
    expect(() => validateTokens(raw)).toThrow("radius.Big");
    delete raw.radius.Big;
    raw.motion.easing.standard = [2, 0, 0, 1];
    expect(() => validateTokens(raw)).toThrow("motion.easing.standard");
  });

  it("rejects line-height smaller than font size", () => {
    const raw = clone() as { typography: { body: { lineHeight: number } } };
    raw.typography.body.lineHeight = 2;
    expect(() => validateTokens(raw)).toThrow("typography.body.lineHeight");
  });
});

describe("generators", () => {
  it("emits unique CSS variable names", () => {
    const names = flattenTokens(tokens).map(([n]) => n);
    expect(new Set(names).size).toBe(names.length);
  });

  it("CSS contains vars, type classes and reduced-motion overrides", () => {
    const css = generateCss(tokens);
    expect(css).toContain("--sonora-color-bg-base: #0A0908;");
    expect(css).toContain(".sonora-type-title-1 {");
    expect(css).toMatch(/prefers-reduced-motion[\s\S]*--sonora-duration-normal: 0ms;/);
  });

  it("Tailwind theme maps `default` to the bare group name", () => {
    const theme = generateTailwindTheme(tokens);
    expect(theme).toContain("--color-accent: var(--sonora-color-accent-default);");
    expect(theme).toContain("--breakpoint-md: 56.25rem;");
  });

  it("Kotlin output uses valid identifiers and damping ratios", () => {
    expect(pascal("bg-base")).toBe("BgBase");
    expect(pascal("2")).toBe("X2");
    const kt = generateKotlin(tokens);
    expect(kt).toContain("val BgBase: Color = Color(0xFF0A0908)");
    expect(kt).toContain("val X4: Dp = 16.dp");
    expect(kt).toMatch(/val Snappy: SpringToken = SpringToken\(stiffness = 520\.0f, dampingRatio = 0\.8332f\)/);
    expect(kt).not.toMatch(/val \d/);
  });
});
