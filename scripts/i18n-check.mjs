// Lists every t("…") / tr("…") text in src/ that has no Spanish entry in src/lib/i18n/es.ts.
// Usage: node scripts/i18n-check.mjs
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const esSrc = readFileSync("src/lib/i18n/es.ts", "utf8");
const json = esSrc.slice(esSrc.indexOf("{"), esSrc.lastIndexOf("}") + 1);
const ES = JSON.parse(json);
const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : /\.(tsx?|mjs)$/.test(f) ? [join(d, f)] : []));
const missing = new Map();
const re = /\b(?:t|tr)\(\s*"((?:[^"\\]|\\.)*)"/g;
for (const file of walk("src").filter((f) => !f.endsWith("i18n/index.ts"))) {
  const s = readFileSync(file, "utf8");
  for (const m of s.matchAll(re)) {
    const key = JSON.parse(`"${m[1]}"`);
    if (!(key in ES)) missing.set(key, [...(missing.get(key) ?? []), file]);
  }
}
for (const [k, files] of missing) console.log(`${JSON.stringify(k)}  ← ${[...new Set(files)].join(", ")}`);
console.log(`\n${missing.size} missing, ${Object.keys(ES).length} in dictionary`);
process.exit(missing.size ? 1 : 0);
