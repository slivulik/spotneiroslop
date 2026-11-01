import { describe, expect, it } from "vitest";
import { accentFor, contrast } from "@/lib/theme";

const BG = { dark: "#0B0A10", light: "#F6F5FA" } as const;
const samples = ["#FFFFFF", "#000000", "#FFFF00", "#00FF00", "#1A1A1A", "#F0F0F0", "#FF5A36", "#2FE0C8", "#7352F5", "#888888", "#123456", "#FEDCBA"];

describe("accentFor", () => {
  for (const theme of ["dark", "light"] as const) {
    it(`keeps WCAG contrast for any input colour (${theme})`, () => {
      for (const input of samples) {
        const set = accentFor(input, theme)!;
        expect(contrast(set.default, BG[theme]), `${input} vs page`).toBeGreaterThanOrEqual(3);
        expect(contrast(set.on, set.default), `${input} text on accent`).toBeGreaterThanOrEqual(4.5);
      }
    });
  }
  it("rejects malformed colours", () => {
    expect(accentFor("violet", "dark")).toBeNull();
  });
});
