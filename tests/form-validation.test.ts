/**
 * Shared form-validation regression tests.
 * Run with: node --experimental-strip-types --test tests/form-validation.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeBdPhone,
  isValidBdPhone,
  isValidEmail,
  isValidHttpUrl,
  normalizeHttpUrl,
  cleanText,
  toNumberInRange,
  toIntInRange,
  isValidTxnId,
  normalizeCouponCode,
  isValidSlug,
  isValidHexColor,
  isValidDateTimeLocal,
  isValidPersonName,
} from "../src/lib/form-validation.ts";

describe("BD phone → +8801XXXXXXXXX canonical", () => {
  it("accepts local 01XXXXXXXXX", () => {
    assert.equal(normalizeBdPhone("01712345678"), "+8801712345678");
  });
  it("accepts +880 and 880 prefixes", () => {
    assert.equal(normalizeBdPhone("+8801712345678"), "+8801712345678");
    assert.equal(normalizeBdPhone("8801712345678"), "+8801712345678");
  });
  it("strips spaces/dashes and converts Bangla digits", () => {
    assert.equal(normalizeBdPhone("+880 1712-345678"), "+8801712345678");
    assert.equal(normalizeBdPhone("০১৭১২৩৪৫৬৭৮"), "+8801712345678");
  });
  it("rejects bad operator digit / short / landline", () => {
    assert.equal(normalizeBdPhone("01212345678"), null);
    assert.equal(normalizeBdPhone("0171234567"), null);
    assert.equal(normalizeBdPhone("02234567890"), null);
    assert.equal(normalizeBdPhone("not a number"), null);
  });
  it("strict check only passes canonical form", () => {
    assert.equal(isValidBdPhone("+8801712345678"), true);
    assert.equal(isValidBdPhone("01712345678"), false);
    assert.equal(isValidBdPhone("+8801712345678 "), true);
  });
});

describe("email / url", () => {
  it("email", () => {
    assert.equal(isValidEmail("a@b.co"), true);
    assert.equal(isValidEmail("bad@"), false);
    assert.equal(isValidEmail("no-at.com"), false);
  });
  it("http url + internal path", () => {
    assert.equal(isValidHttpUrl("https://facebook.com/x"), true);
    assert.equal(isValidHttpUrl("/contact"), true);
    assert.equal(isValidHttpUrl("javascript:alert(1)"), false);
    assert.equal(isValidHttpUrl(""), false);
  });
  it("normalize adds https:// to bare domains", () => {
    assert.equal(normalizeHttpUrl("facebook.com/xyz"), "https://facebook.com/xyz");
    assert.equal(normalizeHttpUrl(""), "");
    assert.equal(normalizeHttpUrl("nota url!!"), null);
  });
});

describe("text / numbers / formats", () => {
  it("cleanText bounds", () => {
    assert.equal(cleanText("  hi  ", 2, 10), "hi");
    assert.equal(cleanText("x", 2, 10), null);
  });
  it("ranges", () => {
    assert.equal(toNumberInRange("5", 1, 10), 5);
    assert.equal(toNumberInRange(0, 1, 10), null);
    assert.equal(toIntInRange(3.5, 1, 10), null);
    assert.equal(toIntInRange("3", 1, 10), 3);
  });
  it("txn id", () => {
    assert.equal(isValidTxnId("8N7DQK2XLM"), true);
    assert.equal(isValidTxnId("ab"), false);
    assert.equal(isValidTxnId("has space"), false);
  });
  it("coupon code uppercases", () => {
    assert.equal(normalizeCouponCode("hsc28"), "HSC28");
    assert.equal(normalizeCouponCode("x"), null);
  });
  it("slug / color / datetime / name", () => {
    assert.equal(isValidSlug("biology-101"), true);
    assert.equal(isValidSlug("Bad Slug!"), false);
    assert.equal(isValidHexColor("#1a3a78"), true);
    assert.equal(isValidHexColor("red"), false);
    assert.equal(isValidDateTimeLocal("2026-09-28T10:30"), true);
    assert.equal(isValidDateTimeLocal("2026-13-99T99:99"), false);
    assert.equal(isValidPersonName("রহিম উদ্দিন"), true);
    assert.equal(isValidPersonName("A"), false);
    assert.equal(isValidPersonName("Name123"), false);
  });
});
