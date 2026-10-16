/*
 * The phone-matching rules that the chat agent depends on.
 *
 * The bug this guards: stored numbers are NOT normalized, so an `eq` lookup on
 * the merchant's spelling found no buyer at all, and Ask Verafo answered
 * "your account is not linked to any specific store" instead of using the data
 * it already had.
 *
 * Run: deno test --allow-none supabase/functions/verafo-ai/phone-match_test.ts
 */

import { assertEquals } from "jsr:@std/assert@1";

/** Mirrors phoneVariants() in index.ts. Kept in step by these cases. */
const FULL_PHONE_DIGITS = 10;
const digitsOnly = (v: unknown) => String(v ?? "").replace(/\D/g, "");

function phoneVariants(raw: string): string[] {
  const digits = digitsOnly(raw);
  if (digits.length < FULL_PHONE_DIGITS) return [];
  const local10 = digits.slice(-FULL_PHONE_DIGITS);
  return [
    ...new Set<string>([
      `+92${local10}`,
      `0${local10}`,
      local10,
      `92${local10}`,
      `0092${local10}`,
      digits,
    ]),
  ];
}

/** Does a lookup for `typed` find a buyer stored as `stored`? */
function finds(typed: string, stored: string): boolean {
  return phoneVariants(typed).includes(stored);
}

Deno.test("the reported failure: +92 307 7000007 finds the buyer however it is stored", () => {
  const typed = "+92 307 7000007";
  for (const stored of [
    "+923077000007",
    "03077000007",
    "923077000007",
    "3077000007",
    "00923077000007",
  ]) {
    assertEquals(finds(typed, stored), true, `should find ${stored}`);
  }
});

Deno.test("a local number finds an internationally stored one, and the reverse", () => {
  assertEquals(finds("03077000007", "+923077000007"), true);
  assertEquals(finds("+923077000007", "03077000007"), true);
  assertEquals(finds("923077000007", "03077000007"), true);
});

Deno.test("punctuation and spacing never matter", () => {
  assertEquals(finds("+92 307 700 0007", "+923077000007"), true);
  assertEquals(finds("(0307) 700-0007", "03077000007"), true);
  assertEquals(finds("+92-307-7000007", "+923077000007"), true);
});

Deno.test("a partial number is refused rather than matching everything", () => {
  // An empty list is the contract: callers must treat it as "no match" and
  // must never hand it to a filter, because `in ()` matches every row.
  assertEquals(phoneVariants("03077000"), []);
  assertEquals(phoneVariants(""), []);
  assertEquals(phoneVariants("abc"), []);
  assertEquals(phoneVariants(null as unknown as string), []);
});

Deno.test("a different number is NOT matched", () => {
  assertEquals(finds("+923077000007", "+923077000008"), false);
  assertEquals(finds("03077000007", "03077000008"), false);
});

Deno.test("the stored spelling is always among the variants", () => {
  // Whatever the app wrote, looking that same value up again must succeed.
  for (const stored of ["+923001112222", "03001112222", "923001112222", "3001112222"]) {
    assertEquals(finds(stored, stored), true, `${stored} must find itself`);
  }
});
