import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateCss } from "./generators/css.ts";
import { generateDts, generateJs } from "./generators/js.ts";
import { generateKotlin } from "./generators/kotlin.ts";
import { generateTailwindTheme } from "./generators/tailwind.ts";
import { loadTokens } from "./load.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const tokens = loadTokens(join(root, "tokens.json"));

const outputs: Record<string, string> = {
  "tokens.css": generateCss(tokens),
  "theme.css": generateTailwindTheme(tokens),
  "index.js": generateJs(tokens),
  "index.d.ts": generateDts(tokens),
  "kotlin/SonoraTokens.kt": generateKotlin(tokens),
};

for (const [file, content] of Object.entries(outputs)) {
  const target = join(dist, file);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
  console.log(`wrote ${file} (${content.length} bytes)`);
}
