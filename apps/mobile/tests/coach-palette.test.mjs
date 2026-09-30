import assert from "node:assert/strict";
import test from "node:test";
import { coachPalette } from "../src/coach-palette.ts";
import { colors } from "../src/theme.ts";

function luminance(hex) {
  const channels = hex.match(/[\da-f]{2}/gi).map((part) => parseInt(part, 16) / 255);
  return channels.map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
    .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
}

test("Coach surface is a subtle darker step with the Arc Track accent and text", () => {
  assert.ok(luminance(coachPalette.background) < luminance(colors.background));
  assert.ok(luminance(colors.background) - luminance(coachPalette.background) > 0.1);
  assert.ok(luminance(coachPalette.surface) > luminance(coachPalette.background));
  assert.ok(luminance(coachPalette.raised) < luminance(coachPalette.background));
  assert.ok(luminance(coachPalette.kpiSurface) < luminance(coachPalette.raised));
  assert.equal(coachPalette.accent, colors.accent);
  assert.equal(coachPalette.text, colors.text);
  assert.equal(coachPalette.muted, colors.muted);
});
