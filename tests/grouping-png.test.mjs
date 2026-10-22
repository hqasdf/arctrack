import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { createGroupingExport, renderGroupingExport } from "../packages/core/src/grouping-export.ts";
import { renderMobileGroupingExport } from "../apps/mobile/src/grouping-export-report.ts";

for (const faceType of ["full_face", "six_ring", "triple_face"]) {
  test(`real PNG rasterization retains full web/mobile ${faceType} reports and bottom totals`, async () => {
    const round = { id: "deterministic-png", name: "Release consistency ".repeat(8), division: "Recurve", distanceMetres: 70, faceDiameterCm: 122, faceType, ends: 12, arrowsPerEnd: 6,
      arrows: Array.from({ length: 65 }, (_, index) => ({ id: String(index), end: Math.floor(index / 6) + 1, arrow: index % 6 + 1, score: index === 0 ? "X" : index === 64 ? "M" : "9", plot: index === 64 ? null : { x: (index % 5 - 2) * .02, y: -.05, ...(faceType === "triple_face" ? { faceIndex: index % 3 } : {}) } })) };
    const report = createGroupingExport(round, "Deterministic test Session");
    const before = structuredClone(report);
    for (const rendered of [renderGroupingExport(report), renderMobileGroupingExport(report)]) {
      const png = await sharp(Buffer.from(rendered.svg)).png().toBuffer();
      assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
      const metadata = await sharp(png).metadata();
      assert.equal(metadata.format, "png"); assert.equal(metadata.width, rendered.width); assert.equal(metadata.height, rendered.height);
      assert.ok(metadata.height > rendered.layout.totalTop + 90);
      const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const index = ((rendered.layout.totalTop + 10) * info.width + Math.floor(info.width / 2)) * info.channels;
      assert.deepEqual([...data.subarray(index, index + 4)], [32, 62, 52, 255], "bottom total card exists in decoded PNG");
      assert.match(rendered.svg, /END 12/); assert.match(rendered.svg, /TOTAL SCORE/);
    }
    assert.deepEqual(report, before, "rendering never modifies scoring/plot data");
  });
}
