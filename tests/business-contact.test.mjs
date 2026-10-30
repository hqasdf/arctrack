import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { BUSINESS_CONTACT_EMAIL, BUSINESS_CONTACT_MAILTO } from "@arc-track/core/contact";

test("public web/mobile contact surfaces consume the shared official contact without hardcoded mailboxes", async () => {
  for (const file of ["src/app/privacy/page.tsx", "src/app/delete-account/page.tsx", "apps/mobile/app/(tabs)/profile.tsx"]) {
    const source = await readFile(new URL("../" + file, import.meta.url), "utf8");
    assert.match(source, /from "@arc-track\/core\/contact"/);
    assert.match(source, /BUSINESS_CONTACT_EMAIL/);
    assert.match(source, /BUSINESS_CONTACT_MAILTO/);
    assert.equal((source.match(/[\w.+%-]+@[\w.-]+\.[A-Za-z]{2,}/g) ?? []).length, 0, file);
  }
});

test("maintained support documentation and email-template example agree with the public contract", async () => {
  for (const file of ["README.md", "docs/auth-setup.md", "apps/mobile/docs/privacy-policy-draft.md"]) {
    const source = await readFile(new URL("../" + file, import.meta.url), "utf8");
    assert.ok(source.includes(BUSINESS_CONTACT_EMAIL), file);
    assert.ok(source.includes(BUSINESS_CONTACT_MAILTO), file);
  }
  assert.equal(BUSINESS_CONTACT_EMAIL, "arctrack0@gmail.com");
});
