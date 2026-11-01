# @sonora/design-tokens

Single source of truth for Sonora's visual language: `tokens.json`.
`pnpm build` validates it and generates:

| Output | Consumer |
|---|---|
| `dist/tokens.css` | CSS variables (`--sonora-*`), typography classes, reduced-motion overrides |
| `dist/theme.css` | Tailwind CSS v4 `@theme` (utilities reference the CSS variables) |
| `dist/index.js` + `.d.ts` | Literal-typed tokens for JS (springs for Motion, durations) |
| `dist/kotlin/SonoraTokens.kt` | Compose: `Color`, `Dp`, `TextUnit`, `CubicBezierEasing`, spring ratios |

```css
@import "tailwindcss";
@import "@sonora/design-tokens/tokens.css";
@import "@sonora/design-tokens/theme.css";
```

Rules enforced at build time (`src/load.ts`): kebab-case names, parseable colours, valid
cubic-bezier control points, line height ≥ font size. Tests also check WCAG contrast of text
colours against the base background — a palette change that breaks AA fails CI.

Springs are authored as stiffness/damping/mass (Motion's model) and converted to Compose's
damping *ratio* `ζ = c / (2·√(k·m))` for Android.
