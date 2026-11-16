import "server-only";
import { cache } from "react";
import { getSession } from "@/lib/auth";
import { asLocale, makeT, type Locale } from "./index";

/** The signed-in person's language (English if not signed in). One lookup per request. */
export const getLocale = cache(async (): Promise<Locale> => {
  try {
    const { profile } = await getSession();
    return asLocale((profile as { language?: string }).language);
  } catch {
    return "en";
  }
});

export async function getT() {
  const locale = await getLocale();
  return Object.assign(makeT(locale), { locale });
}
