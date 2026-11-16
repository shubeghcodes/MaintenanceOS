import { ES } from "./es";

/**
 * Tiny translation layer. Screen text is written in English and wrapped in t("…"); the Spanish dictionary is
 * keyed by that English text, and anything missing falls back to English. Placeholders: t("{n} jobs", { n: 3 }).
 */
export type Locale = "en" | "es";
export const LOCALES: { value: Locale; label: string }[] = [
  { value: "en", label: "English" },
  { value: "es", label: "Español" },
];
export type Vars = Record<string, string | number | null | undefined>;
export type T = (text: string, vars?: Vars) => string;

export const asLocale = (v: unknown): Locale => (v === "es" ? "es" : "en");

const fill = (s: string, vars: Vars) => s.replace(/\{(\w+)\}/g, (_, k: string) => (vars[k] == null ? "" : String(vars[k])));

// Messages that arrive already filled in (e.g. server errors: "…: 9 item(s) still need…") are matched against
// the dictionary's templates, so they translate too.
let patterns: { re: RegExp; keys: string[]; es: string }[] | null = null;
function fromPattern(text: string): string | null {
  patterns ??= Object.entries(ES)
    .filter(([k]) => /\{\w+\}/.test(k))
    .map(([k, es]) => {
      const keys: string[] = [];
      const src = k
        .split(/(\{\w+\})/)
        .map((part) => {
          const m = part.match(/^\{(\w+)\}$/);
          if (m) {
            keys.push(m[1]);
            return "(.+?)";
          }
          return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        })
        .join("");
      return { re: new RegExp(`^${src}$`), keys, es };
    });
  for (const p of patterns) {
    const m = text.match(p.re);
    if (m) return fill(p.es, Object.fromEntries(p.keys.map((k, i) => [k, m[i + 1]])));
  }
  return null;
}

export function translate(locale: Locale, text: string, vars?: Vars): string {
  if (locale !== "es") return vars ? fill(text, vars) : text;
  const hit = ES[text];
  if (hit != null) return vars ? fill(hit, vars) : hit;
  if (!vars && text.length < 300) {
    const p = fromPattern(text);
    if (p) return p;
  }
  return vars ? fill(text, vars) : text;
}

export const makeT = (locale: Locale): T => (text, vars) => translate(locale, text, vars);

/** "1 job" / "3 jobs" (and the Spanish forms, which are separate dictionary entries). */
export const plural = (t: T, n: number, one: string, many: string) => t(n === 1 ? one : many, { n });

/** Locale code for dates and numbers. */
export const intlLocale = (locale: Locale) => (locale === "es" ? "es-US" : "en-US");
