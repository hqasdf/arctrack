import test from "node:test";
import assert from "node:assert/strict";
import { BUSINESS_CONTACT_EMAIL, BUSINESS_CONTACT_MAILTO } from "../src/contact.ts";

test("official public contact and mailto remain consistent without credentials or prefilled personal information", () => {
  assert.equal(BUSINESS_CONTACT_EMAIL, "arctrack0@gmail.com");
  assert.equal(BUSINESS_CONTACT_MAILTO, "mailto:arctrack0@gmail.com");
});
