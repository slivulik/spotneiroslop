export type CubicBezier = readonly [number, number, number, number];

export interface Spring {
  readonly stiffness: number;
  readonly damping: number;
  readonly mass: number;
}

export type FontRole = "display" | "text" | "mono";

export interface TypeStyle {
  /** Font size in px (sp on Android). */
  readonly size: number;
  /** Line height in px (sp on Android). */
  readonly lineHeight: number;
  readonly weight: number;
  /** Letter spacing in em. */
  readonly tracking: number;
  readonly family: FontRole;
}

/** Nested map of colour strings, e.g. color.bg.base. */
export type ColorGroup = Readonly<Record<string, Readonly<Record<string, string>>>>;

export interface Tokens {
  readonly brand: { readonly name: string };
  readonly color: ColorGroup;
  readonly font: {
    readonly family: Readonly<Record<FontRole, string>>;
    readonly weight: Readonly<Record<string, number>>;
  };
  readonly typography: Readonly<Record<string, TypeStyle>>;
  readonly space: Readonly<Record<string, number>>;
  readonly radius: Readonly<Record<string, number>>;
  readonly shadow: Readonly<Record<string, string>>;
  readonly blur: Readonly<Record<string, number>>;
  readonly motion: {
    readonly duration: Readonly<Record<string, number>>;
    readonly easing: Readonly<Record<string, CubicBezier>>;
    readonly spring: Readonly<Record<string, Spring>>;
  };
  readonly breakpoint: Readonly<Record<string, number>>;
  /** Alternate themes override colours only; every key must exist in the base palette. */
  readonly themes: Readonly<Record<string, { readonly color: ColorGroup }>>;
  readonly opacity: Readonly<Record<string, number>>;
  readonly border: Readonly<Record<string, number>>;
  readonly layer: Readonly<Record<string, number>>;
}
