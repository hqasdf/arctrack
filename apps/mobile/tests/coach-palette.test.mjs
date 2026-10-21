import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { coachPalette, getCoachPalette } from "../src/coach-palette.ts";
import { organizationAppearance } from "../src/organization-appearance.ts";

function luminance(hex) {
  const channels = hex.match(/[\da-f]{2}/gi).map((part) => parseInt(part, 16) / 255);
  return channels.map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
    .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
}

test("Coach surfaces and text follow the website Head Coach appearance", () => {
  const website = organizationAppearance("light", true);
  assert.equal(coachPalette.background, website.background);
  assert.equal(coachPalette.surface, website.surface);
  assert.ok(luminance(coachPalette.surface) > luminance(coachPalette.background));
  assert.equal(coachPalette.accent, website.primary);
  assert.equal(coachPalette.text, website.text);
  assert.equal(coachPalette.muted, website.muted);
  for (const [foreground, background] of [[coachPalette.text, coachPalette.surface], [coachPalette.kpiText, coachPalette.kpiSurface]]) {
    assert.ok((luminance(background) + .05) / (luminance(foreground) + .05) >= 4.5);
  }
});

const css = readFileSync(new URL("../../../src/features/organizations/components/coach.module.css", import.meta.url), "utf8");
const blocks = [...css.matchAll(/\{([^{}]*--coach-background:[^{}]*)\}/g)].map((match) => match[1]);
for (const mode of ["light", "dark"]) {
  test(`Coach ${mode} palette follows authoritative website tokens and remains stable`, () => {
    const palette = getCoachPalette(mode);
    assert.equal(getCoachPalette(mode), palette);
    const block = blocks[mode === "dark" ? 1 : 0];
    assert.ok(block, "Website coach token block exists");
    const tokens = Object.fromEntries([...block.matchAll(/--coach-([\w-]+):\s*(#[\da-f]+)/gi)].map((match) => [match[1], match[2].toLowerCase()]));
    for (const [mobile, web] of Object.entries({ background: "background", surface: "surface", raised: "elevated", text: "text", muted: "muted", accent: "accent", onPrimary: "on-primary", border: "border", secondary: "chart-secondary", kpiSurface: "summary", inputBorder: "input-border" })) {
      assert.equal(palette[mobile].toLowerCase(), tokens[web], mobile);
    }
    for (const [foreground, background] of [[palette.text, palette.surface], [palette.muted, palette.surface], [palette.kpiText, palette.kpiSurface], [palette.onPrimary, palette.accent]]) {
      const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
      assert.ok((values[0] + .05) / (values[1] + .05) >= 4.5, foreground + " on " + background);
    }
  });
}
test("Static coach compatibility remains light while resolved palettes are distinct", () => {
  assert.equal(coachPalette, getCoachPalette("light"));
  assert.notEqual(getCoachPalette("light"), getCoachPalette("dark"));
});
