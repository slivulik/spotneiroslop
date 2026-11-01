import { readFileSync } from "node:fs";
import { parseColor } from "./color.ts";
import type { FontRole, Tokens } from "./types.ts";

const FONT_ROLES: readonly FontRole[] = ["display", "text", "mono"];
const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function fail(path: string, message: string): never {
  throw new Error(`tokens.json: ${path}: ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) fail(path, "expected an object");
  for (const key of Object.keys(value)) {
    if (!NAME_RE.test(key)) fail(`${path}.${key}`, "token names must be kebab-case [a-z0-9-]");
  }
  return value;
}

function finiteNumber(value: unknown, path: string, min = Number.NEGATIVE_INFINITY): number {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(path, "expected a finite number");
  if (value < min) fail(path, `expected >= ${min}`);
  return value;
}

function numberMap(value: unknown, path: string, min = 0): void {
  for (const [k, v] of Object.entries(record(value, path))) finiteNumber(v, `${path}.${k}`, min);
}

/**
 * Validates the raw JSON structure. Throws with a precise path on the first problem,
 * so a broken token file fails the build instead of producing broken CSS/Kotlin.
 */
export function validateTokens(raw: unknown): Tokens {
  const root = isRecord(raw) ? raw : fail("$", "expected an object");

  const brand = isRecord(root.brand) ? root.brand : fail("brand", "expected an object");
  if (typeof brand.name !== "string" || brand.name.length === 0) fail("brand.name", "expected a non-empty string");

  for (const [group, entries] of Object.entries(record(root.color, "color"))) {
    for (const [name, value] of Object.entries(record(entries, `color.${group}`))) {
      if (typeof value !== "string") fail(`color.${group}.${name}`, "expected a colour string");
      try {
        parseColor(value);
      } catch (error) {
        fail(`color.${group}.${name}`, (error as Error).message);
      }
    }
  }

  const font = isRecord(root.font) ? root.font : fail("font", "expected an object");
  const family = record(font.family, "font.family");
  for (const role of FONT_ROLES) {
    if (typeof family[role] !== "string") fail(`font.family.${role}`, "expected a font stack string");
  }
  numberMap(font.weight, "font.weight", 100);

  for (const [name, style] of Object.entries(record(root.typography, "typography"))) {
    const path = `typography.${name}`;
    if (!isRecord(style)) fail(path, "expected an object");
    finiteNumber(style.size, `${path}.size`, 1);
    const lineHeight = finiteNumber(style.lineHeight, `${path}.lineHeight`, 1);
    if (lineHeight < (style.size as number)) fail(`${path}.lineHeight`, "must be >= size");
    finiteNumber(style.weight, `${path}.weight`, 100);
    finiteNumber(style.tracking, `${path}.tracking`);
    if (!FONT_ROLES.includes(style.family as FontRole)) fail(`${path}.family`, `expected one of ${FONT_ROLES.join(", ")}`);
  }

  for (const [theme, def] of Object.entries(record(root.themes, "themes"))) {
    const colors = record(isRecord(def) ? def.color : undefined, `themes.${theme}.color`);
    const base = root.color as Record<string, Record<string, unknown>>;
    for (const [group, entries] of Object.entries(colors)) {
      for (const [name, value] of Object.entries(record(entries, `themes.${theme}.color.${group}`))) {
        const path = `themes.${theme}.color.${group}.${name}`;
        if (!base[group] || !(name in base[group])) fail(path, "not in the base palette");
        if (typeof value !== "string") fail(path, "expected a colour string");
        try {
          parseColor(value);
        } catch (error) {
          fail(path, (error as Error).message);
        }
      }
    }
  }
  for (const [k, v] of Object.entries(record(root.opacity, "opacity"))) {
    const n = finiteNumber(v, `opacity.${k}`, 0);
    if (n > 1) fail(`opacity.${k}`, "must be within [0, 1]");
  }
  numberMap(root.border, "border");
  numberMap(root.space, "space");
  numberMap(root.radius, "radius");
  numberMap(root.blur, "blur");
  numberMap(root.breakpoint, "breakpoint");
  numberMap(root.layer, "layer");
  for (const [k, v] of Object.entries(record(root.shadow, "shadow"))) {
    if (typeof v !== "string") fail(`shadow.${k}`, "expected a CSS shadow string");
  }

  const motion = isRecord(root.motion) ? root.motion : fail("motion", "expected an object");
  numberMap(motion.duration, "motion.duration");
  for (const [k, v] of Object.entries(record(motion.easing, "motion.easing"))) {
    const path = `motion.easing.${k}`;
    if (!Array.isArray(v) || v.length !== 4) fail(path, "expected [x1, y1, x2, y2]");
    v.forEach((n, i) => finiteNumber(n, `${path}[${i}]`));
    const [x1, , x2] = v as number[];
    if ((x1 as number) < 0 || (x1 as number) > 1 || (x2 as number) < 0 || (x2 as number) > 1) {
      fail(path, "x control points must be within [0, 1]");
    }
  }
  for (const [k, v] of Object.entries(record(motion.spring, "motion.spring"))) {
    const path = `motion.spring.${k}`;
    if (!isRecord(v)) fail(path, "expected an object");
    finiteNumber(v.stiffness, `${path}.stiffness`, 1);
    finiteNumber(v.damping, `${path}.damping`, 0);
    finiteNumber(v.mass, `${path}.mass`, 0.01);
  }

  return raw as Tokens;
}

export function loadTokens(path: URL | string): Tokens {
  return validateTokens(JSON.parse(readFileSync(path, "utf8")) as unknown);
}
