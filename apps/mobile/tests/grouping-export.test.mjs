import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createGroupingExport, renderGroupingExport } from "@arc-track/core/grouping-export";
import { mapSessionDetail } from "../src/session-mapper.ts";
import { mobileRoundInsights } from "../src/mobile-analytics.ts";
import { EXPORT_TOP_PADDING, mobileExportPreviewWidth, renderMobileGroupingExport } from "../src/grouping-export-report.ts";

const round = (arrows = [], ends = 6, faceType = "full_face") => ({ id: "qa-export", name: "A long Round name with readable wrapping", division: "Recurve", distanceMetres: 70, faceDiameterCm: 122, faceType, ends, arrowsPerEnd: 6, arrows });
const arrow = (end, number, score = "9") => ({ id: `${end}-${number}`, end, arrow: number, score, plot: { x: number * .02, y: -.02, faceIndex: (number - 1) % 3 } });

test("mobile preview has safe-area support, 100px padding, scrolling and a static single PNG source", async () => {
  const source = await readFile(new URL("../src/grouping-export.tsx", import.meta.url), "utf8");
  assert.equal(EXPORT_TOP_PADDING, 100);
  assert.match(source, /SafeAreaView.*edges={\["top", "right", "bottom", "left"\]}/);
  assert.match(source, /paddingTop: EXPORT_TOP_PADDING/);
  assert.match(source, /<ScrollView.*horizontal={false}/);
  assert.match(source, /renderMobileGroupingExport\(report\)/);
  assert.match(source, /SvgXml xml={svg}/);
  assert.match(source, /toDataURL\(resolve, { width, height }\)/);
  assert.match(source, /Sharing.shareAsync\(file/);
  assert.doesNotMatch(source, /onResponder|onPlot|scoreFromPlot/);
  for (const width of [320, 360, 375, 390, 414, 430]) assert.ok(mobileExportPreviewWidth(width) + 24 <= width);
});

test("mobile report exposes every existing grouping and Round summary result without changing formulas", () => {
  const input = round(Array.from({ length: 36 }, (_, i) => arrow(Math.floor(i / 6) + 1, i % 6 + 1, i === 0 ? "X" : "9")));
  const report = createGroupingExport(input);
  const rendered = renderMobileGroupingExport(report);
  const insight = mobileRoundInsights(input);
  const values = Object.fromEntries(rendered.stats);
  for (const label of ["Group position", "Group size", "Horizontal Spread", "Vertical Spread", "RMS spread", "Plotted Arrows", "Possible Flyers", "Round status", "Recorded Arrows", "Avg / Arrow", "X", "10 + X", "Best completed End", "Consistency"]) assert.ok(label in values);
  assert.equal(values["Group size"], `${insight.grouping.metrics.groupSizeCm.toFixed(1)} cm`);
  assert.equal(values["Possible Flyers"], String(insight.mainGroup.flyers.length));
  assert.equal(values["Avg / Arrow"], insight.average.toFixed(2));
  assert.equal(values["Group position"], "4.3 cm right · 1.2 cm high");
  assert.equal(values["Round status"], "Completed Round");
  assert.equal(values["Recorded Arrows"], "36/36");
  assert.equal(report.total, 325);
  assert.match(rendered.svg, />325 · 1X</);
  assert.equal(report.ends.length, 6);
  assert.equal(report.ends.flatMap((end) => end.arrows).length, 36);
  assert.match(rendered.svg, /y="116"[^>]*>ARC TRACK/);
  assert.doesNotMatch(rendered.svg, /Save \/ Share|undefined|NaN|onResponder/);
});

test("partial, empty and long reports retain X/M, every End/Arrow, correct totals and grow in height", () => {
  const partial = createGroupingExport(round([arrow(1, 1, "X"), arrow(1, 2, "M"), arrow(1, 3, "8")]));
  const rendered = renderMobileGroupingExport(partial);
  assert.match(rendered.svg, /10X · M · 8/);
  assert.match(rendered.svg, />18 pts</);
  assert.match(rendered.svg, /Partial 3\/6/);
  assert.equal(partial.ends[1].score, null);
  const empty = renderMobileGroupingExport(createGroupingExport(round()));
  assert.match(empty.svg, /No plotted Arrows yet/);
  assert.match(empty.svg, />—</);
  const long = renderMobileGroupingExport(createGroupingExport(round(Array.from({ length: 120 }, (_, i) => arrow(Math.floor(i / 6) + 1, i % 6 + 1)), 20)));
  assert.ok(long.height > rendered.height);
  assert.match(long.svg, />END 20</);
  assert.match(long.svg, />1080 · 0X</);
  assert.ok(long.height > Math.max(...[...long.svg.matchAll(/<text[^>]* y="(\d+)"/g)].map((match) => +match[1])));
});

test("mobile target keeps shared geometry/raw coordinates for every layout and freezes one snapshot", () => {
  for (const face of ["full_face", "six_ring", "triple_face"]) {
    const input = round([arrow(1, 1, "10"), arrow(1, 2, "X"), arrow(1, 3, "M")], 6, face);
    const report = createGroupingExport(input);
    const before = renderMobileGroupingExport(report);
    input.arrows[0].plot.x = .7; input.arrows[0].score = "M";
    assert.deepEqual(renderMobileGroupingExport(report), before);
    assert.equal(report.round.arrows[0].plot.x, .02);
    assert.match(before.svg, /cx="2"/);
    assert.equal((before.svg.match(/<svg\b/g) ?? []).length, 1);
    assert.match(before.svg, /clip-path="url\(#export-target-bounds\)"/);
  }
});

test("full reader hierarchy and current Arrow state retain identical web/Expo export score content", () => {
  const dbArrow = (number, points, isX = false) => ({ id: `a-${number}`, arrow_number: number, score_points: points, is_x: isX, plot_x: .02, plot_y: .03, face_index: null });
  const row = { id: "session", title: "Practice", session_date: "2026-10-04", session_type: "training", arrow_count: 200,
    session_rounds: [{ id: "right-round", round_number: 4, name: "70 m", division: "Recurve", distance_metres: 70, face_diameter_cm: 122, face_type: "full_face", planned_ends: 4, arrows_per_end: 6,
      session_ends: [
        { end_number: 3, arrows: [dbArrow(3, 8), dbArrow(1, 9), dbArrow(2, 9)] },
        { end_number: 2, arrows: [] },
        { end_number: 1, arrows: [dbArrow(6, 0), dbArrow(2, 10), dbArrow(1, 10, true), dbArrow(5, 10), dbArrow(4, 8), dbArrow(3, 9)] },
      ] }] };
  const loaded = mapSessionDetail(row).rounds.find((item) => item.id === "right-round");
  assert.equal(loaded.arrows.length, 9);
  // Scoring passes all current Arrows, including later local edits, not just the current End.
  const current = { ...loaded, arrows: [...loaded.arrows, { id: "new", end: 4, arrow: 1, score: "X", plot: { x: .058, y: 0 } }] };
  const web = createGroupingExport(current);
  const expo = createGroupingExport(current);
  assert.deepEqual(expo.ends, web.ends);
  assert.equal(expo.total, web.total);
  assert.equal(expo.xCount, web.xCount);
  assert.deepEqual(expo.ends.map((end) => end.score), [47, null, 26, 10]);
  assert.equal(expo.total, 83); assert.equal(expo.xCount, 2);
  const mobileSvg = renderMobileGroupingExport(expo).svg;
  const webSvg = renderGroupingExport(web).svg;
  for (const end of web.ends) {
    for (const svg of [mobileSvg, webSvg]) {
      assert.match(svg, new RegExp(`>END ${end.end}<`));
      if (end.score !== null) assert.match(svg, new RegExp(`>${end.score} pts<`));
    }
    for (const entry of end.arrows) assert.ok(mobileSvg.includes(entry.label));
  }
  assert.match(mobileSvg, /10X · 10 · 9 · 8 · 10 · M/);
  assert.match(mobileSvg, /9 · 9 · 8/);
  assert.match(mobileSvg, />83 · 2X</);
  assert.match(webSvg, />83</); assert.match(webSvg, />2X</);
});

test("3/6/12-End report bounds grow with content and total stays below every End", () => {
  const reports = [3, 6, 12].map((ends) => renderMobileGroupingExport(createGroupingExport(round(
    Array.from({ length: ends * 6 }, (_, i) => arrow(Math.floor(i / 6) + 1, i % 6 + 1)), ends))));
  for (const report of reports) {
    const { layout } = report;
    assert.equal(layout.targetWidth, 291);
    assert.equal(layout.targetHeight, layout.targetWidth);
    assert.equal(layout.statsTop, layout.targetTop + layout.targetHeight + 24);
    assert.ok(layout.endsTop > layout.statsTop);
    assert.ok(layout.endPositions.every((position, i, list) => position < report.height && (i === 0 || position > list[i - 1])));
    assert.ok(layout.totalTop > layout.endPositions.at(-1));
    const textPositions = [...report.svg.matchAll(/<text[^>]* y="(\d+)"/g)].map((match) => +match[1]);
    assert.ok(textPositions.every((position) => position >= 100 && position < report.height));
    assert.equal(report.height - Math.max(...textPositions), 40, "bottom padding is small and fixed, not a giant blank canvas");
    assert.match(report.svg, new RegExp(`viewBox="0 0 ${report.width} ${report.height}"`));
    for (const screen of [320, 360, 390, 430]) {
      const previewWidth = mobileExportPreviewWidth(screen);
      const previewHeight = report.height * previewWidth / report.width;
      assert.ok(Math.abs(previewHeight / previewWidth - report.height / report.width) < 1e-12);
    }
  }
  assert.ok(reports[0].height < reports[1].height && reports[1].height < reports[2].height);
});

test("native preview mounts exactly one SVG root and captures that root, without a nested SvgXml viewport", async () => {
  const source = await readFile(new URL("../src/grouping-export.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /<Svg\s/);
  assert.match(source, /<SvgXml xml={svg} override={{ ref: image, width: previewWidth, height: height \* previewWidth \/ width/);
  assert.match(source, /viewBox: `0 0 \$\{width\} \$\{height\}`/);
  assert.match(source, /preserveAspectRatio: "xMidYMid meet"/);
});
