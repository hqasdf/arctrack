import assert from "node:assert/strict";
import test from "node:test";
import { createGroupingExport, renderGroupingExport } from "../src/grouping-export.ts";
import { calculateGroupingForArrows } from "../src/session-insights-model.ts";

const round = { id: "round", roundNumber: 3, name: 'Round <one> & "two"', division: "Recurve",
  distanceMetres: 70, ends: 3, arrowsPerEnd: 6, faceDiameterCm: 122, faceType: "full_face",
  arrows: [
    { id: "a2", end: 1, arrow: 2, score: "9", plot: { x: .208, y: 0 } },
    { id: "a1", end: 1, arrow: 1, score: "X", plot: { x: .058, y: 0 } },
    { id: "a3", end: 1, arrow: 3, score: "8", plot: { x: .218, y: .1 } },
    { id: "m", end: 3, arrow: 1, score: "M", plot: null },
  ] };

test("export includes all planned Ends, ordered Arrow values, X/M, partial/empty scores and total", () => {
  const report = createGroupingExport(round, "Practice");
  assert.deepEqual(report.ends.map((end) => end.end), [1, 2, 3]);
  assert.deepEqual(report.ends.map((end) => end.score), [27, null, 0]);
  assert.deepEqual(report.ends[0].arrows.map((arrow) => arrow.label), ["10X", "9", "8"]);
  assert.deepEqual(report.ends[2].arrows, [{ number: 1, label: "M" }]);
  assert.equal(report.total, 27); assert.equal(report.xCount, 1);
});

test("export is one detached snapshot and preserves raw coordinates and authoritative corrected scores", () => {
  const input = structuredClone(round);
  const report = createGroupingExport(input);
  input.arrows[0].score = "10"; input.arrows[0].plot.x = .9;
  assert.equal(report.ends[0].arrows[1].label, "9");
  assert.equal(report.grouping.arrows[0].x, .208);
  assert.equal(report.total, 27);
  assert.deepEqual(report.grouping, calculateGroupingForArrows(round.arrows, round.faceType, round.faceDiameterCm));
});

test("static report safely escapes text and excludes interactive UI", () => {
  const { svg, width, height } = renderGroupingExport(createGroupingExport(round));
  assert.equal(width, 800); assert.ok(height > 600);
  assert.match(svg, /Round &lt;one&gt; &amp; &quot;two&quot;/);
  assert.match(svg, /10X · 9 · 8/); assert.match(svg, /END 2/); assert.match(svg, /27 pts/);
  assert.doesNotMatch(svg, /onClick|Retry|Reset zoom|selectedHalo|foreignObject/);
});

test("all layouts keep original plot coordinates, and triple markers stay on their local faces", () => {
  for (const faceType of ["full_face", "six_ring", "triple_face"]) {
    const input = structuredClone(round); input.faceType = faceType;
    input.arrows[0].plot.faceIndex = 0; input.arrows[1].plot.faceIndex = 2; input.arrows[2].plot.faceIndex = 1;
    const report = createGroupingExport(input);
    assert.deepEqual(report.round.arrows, input.arrows);
    assert.equal(report.grouping.arrows.length, 3);
    const { svg } = renderGroupingExport(report);
    if (faceType === "triple_face") { assert.match(svg, /cy="-110"/); assert.match(svg, /cy="110"/); }
  }
});

test("large Ends retain every entered Arrow rather than truncating to one report row", () => {
  const input = { ...round, ends: 1, arrows: Array.from({ length: 50 }, (_, i) => ({ id: String(i),
    end: 1, arrow: i + 1, score: "X", plot: null })) };
  const report = createGroupingExport(input);
  assert.equal(report.ends[0].arrows.length, 50); assert.equal(report.total, 500);
  assert.equal((renderGroupingExport(report).svg.match(/10X/g) ?? []).length, 50);
});

test("export main-group crosshairs and all-Arrow average dots preserve hulls, coordinates and metrics", () => {
  for (const faceType of ["full_face", "six_ring", "triple_face"]) {
    for (const [x, y] of [[0, 0], [-.2, 0], [.2, 0], [0, -.2], [0, .2], [.2, -.2]]) {
      const offsets = [[-.03, -.02], [.03, -.02], [0, .04]];
      const input = { ...round, faceType, arrows: Array.from({ length: faceType === "triple_face" ? 9 : 3 }, (_, index) => ({ id: `a${index}`, end: 1, arrow: index + 1, score: "9", plot: { x: x + offsets[index % 3][0], y: y + offsets[index % 3][1], ...(faceType === "triple_face" ? { faceIndex: Math.floor(index / 3) } : {}) } })) };
      const report = createGroupingExport(input), before = structuredClone(report);
      const { svg } = renderGroupingExport(report);
      const scale = Number(svg.match(/data-target-plot="true" transform="translate\([^)]+\) scale\(([^)]+)\)"/)[1]);
      const centres = faceType === "triple_face" ? [-110, 0, 110] : [0];
      assert.doesNotMatch(svg, /data-target-centre=|data-group-centre=/);
      assert.match(svg, />Main Group Centre<\/text>/);
      assert.match(svg, />All-Arrow Average<\/text>/);
      assert.equal((svg.match(/data-average-impact=/g) ?? []).length, centres.length);
      assert.equal((svg.match(/data-main-group-centre=/g) ?? []).length, centres.length);
      centres.forEach((cy, index) => {
        const arrows = report.mainGroup.mainArrows.filter(arrow => faceType !== "triple_face" || arrow.faceIndex === index);
        const plotted = report.grouping.arrows.filter(arrow => faceType !== "triple_face" || arrow.faceIndex === index);
        const { centreX, centreY } = report.mainGroup.metrics;
        const cx = centreX * 100, yy = cy + centreY * 100;
        const extent = 10 / scale, gap = 3.5 / scale;
        assert.ok(svg.includes(`data-main-group-centre="${index}" pointer-events="none" fill="none"><path d="M ${cx - extent} ${yy} H ${cx - gap} M ${cx + gap} ${yy} H ${cx + extent} M ${cx} ${yy - extent} V ${yy - gap} M ${cx} ${yy + gap} V ${yy + extent}"`));
        assert.ok(svg.includes(`<circle cx="${cx}" cy="${yy}" r="${3 / scale}"`));
        const meanX = plotted.reduce((sum, arrow) => sum + arrow.x, 0) / plotted.length * 100;
        const meanY = cy + plotted.reduce((sum, arrow) => sum + arrow.y, 0) / plotted.length * 100;
        assert.ok(svg.includes(`data-average-impact="${index}" pointer-events="none"><circle cx="${meanX}" cy="${meanY}" r="${1.5 / scale}"`));
        assert.ok(Math.abs(centreX - x) < .005 && Math.abs(centreY - y) < .02);
        const polygon = [...svg.matchAll(/<polygon points="([^"]+)"/g)][index][1].split(" ").map(point => point.split(",").map(Number));
        assert.equal(polygon.length, 3);
        for (const arrow of arrows) assert.ok(polygon.some(([px, py]) => px === arrow.x * 100 && py === cy + arrow.y * 100));
      });
      report.grouping.arrows.forEach(arrow => {
        const marker = `<circle cx="${arrow.x * 100}" cy="${(faceType === "triple_face" ? centres[arrow.faceIndex] : 0) + arrow.y * 100}" r="1.8"`;
        assert.ok(svg.includes(marker));
        assert.ok(svg.indexOf(marker) > svg.lastIndexOf('<polygon'), "Arrow dots render above the hull");
        assert.ok(svg.indexOf(marker) < svg.indexOf('data-main-group-centre='), "The hollow primary indicator stays visible over overlapping dots");
      });
      assert.deepEqual(report, before);
      assert.deepEqual(report.round.arrows, input.arrows);
      assert.equal(report.total, input.arrows.length * 9);
    }
  }
});

test("empty and sparse groups do not invent a grouping area or a bullseye crosshair", () => {
  for (const count of [0, 1, 2]) {
    const { svg } = renderGroupingExport(createGroupingExport({ ...round, arrows: round.arrows.slice(0, count) }));
    assert.doesNotMatch(svg, /data-target-centre=|<polygon/);
    assert.equal((svg.match(/data-average-impact=/g) ?? []).length, count ? 1 : 0);
    if (count === 0) assert.doesNotMatch(svg, /data-main-group-centre=|data-average-impact=/);
    if (count === 1) {
      assert.match(svg, /data-main-group-centre="0"[\s\S]*?<circle cx="20.8" cy="0"/);
      assert.match(svg, /data-average-impact="0"[^>]*><circle cx="20.8" cy="0"/);
      assert.ok(svg.indexOf('data-main-group-centre=') < svg.indexOf('data-average-impact='));
    }
    assert.doesNotMatch(svg, /NaN|Infinity/);
  }
});

test("asymmetric groups average all displayed Arrows including flyers, not the robust median", () => {
  const points = [[0, 0], [.01, 0], [0, .01], [-.01, 0], [0, -.01], [.6, -.3]];
  const input = { ...round, arrows: points.map(([x, y], i) => ({ id: String(i), end: 1, arrow: i + 1, score: "9", plot: { x, y } })) };
  const report = createGroupingExport(input), before = structuredClone(report);
  assert.equal(report.mainGroup.flyers.length, 1);
  const { svg } = renderGroupingExport(report);
  assert.match(svg, /data-average-impact="0"[^>]*><circle cx="10" cy="-5"/);
  const { centreX, centreY } = report.mainGroup.metrics;
  assert.ok(svg.includes(`<circle cx="${centreX * 100}" cy="${centreY * 100}" r="`));
  const averageMarker = svg.match(/<g data-average-impact="0"[\s\S]*?<\/g>/)[0];
  assert.doesNotMatch(averageMarker, /<path|<line/);
  const mainMarker = svg.match(/<g data-main-group-centre="0"[\s\S]*?<\/g>/)[0];
  const scale = Number(svg.match(/data-target-plot="true" transform="translate\([^)]+\) scale\(([^)]+)\)"/)[1]);
  assert.ok(mainMarker.includes(`M ${-10 / scale} 0 H ${-3.5 / scale}`));
  assert.ok(Math.abs(report.mainGroup.metrics.centreX - .1) > .05);
  assert.ok(Math.abs(report.mainGroup.metrics.centreY + .05) > .02);
  assert.deepEqual(report, before);
  // The original main-group hull still excludes the displayed flyer.
  const polygon = svg.match(/<polygon points="([^"]+)"/)[1];
  assert.equal(polygon, '-1,0 0,-1 1,0 0,1');
  assert.ok(svg.includes('<circle cx="60" cy="-30" r="1.8"'));
});

test("triple-face means use each spot's own local Arrow population", () => {
  const input = { ...round, faceType: "triple_face", arrows: [
    { id: "a", end: 1, arrow: 1, score: "9", plot: { x: -.2, y: -.1, faceIndex: 0 } },
    { id: "b", end: 1, arrow: 2, score: "9", plot: { x: -.1, y: -.2, faceIndex: 0 } },
    { id: "c", end: 1, arrow: 3, score: "9", plot: { x: .3, y: .2, faceIndex: 2 } },
  ] };
  const report = createGroupingExport(input), { svg } = renderGroupingExport(report);
  const meanX = (-.2 + -.1) / 2 * 100, meanY = -110 + (-.1 + -.2) / 2 * 100;
  assert.ok(svg.includes(`<circle cx="${meanX}" cy="${meanY}" r="`));
  assert.match(svg, /data-average-impact="2"[^>]*><circle cx="30" cy="130"/);
  assert.doesNotMatch(svg, /data-average-impact="1"/);
  assert.equal((svg.match(/data-average-impact=/g) ?? []).length, 2);
});

test("report separates the legend from the target, preserves Session context and caps crosshair arms", () => {
  const report = createGroupingExport({ ...round, arrows: [
    { id: "a", end: 1, arrow: 1, score: "9", plot: { x: -.3, y: 0 } },
    { id: "b", end: 1, arrow: 2, score: "9", plot: { x: .3, y: 0 } },
    { id: "c", end: 1, arrow: 3, score: "9", plot: { x: 0, y: .3 } },
  ] }, "Range practice · 2026-10-17");
  for (const width of [390, 800]) {
    const { svg, layout } = renderGroupingExport(report, { width });
    assert.match(svg, />Range practice</);
    assert.match(svg, /2026-10-17 · Recurve/);
    assert.ok(layout.legendTop > layout.targetTop + layout.targetHeight);
    assert.ok(layout.statsTop > layout.legendTop);
    assert.equal((svg.match(/data-legend-item=/g) ?? []).length, 3);
    assert.match(svg, />Main Group Area</);
    const plot = svg.slice(svg.indexOf('data-target-plot='), svg.indexOf('data-legend-item='));
    assert.doesNotMatch(plot, /<text/);
    const path = svg.match(/data-main-group-centre="0"[^>]*><path d="([^"]+)"/)[1];
    const values = path.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/g).map(Number);
    assert.ok(Math.abs(values[5] - values[0]) <= 20.000001);
    assert.equal((svg.match(/<svg\b/g) ?? []).length, 1);
  }
});

test("wide unbroken names and long precise values wrap without truncation", () => {
  const name = "W".repeat(80), value = "123456789012345678901234567890.1 cm";
  const report = createGroupingExport({ ...round, name }, `${name} · 2026-10-17`);
  for (const width of [390, 800]) {
    const { svg } = renderGroupingExport(report, { width, stats: [["Group position", value]] });
    const wideLines = [...svg.matchAll(/<text[^>]*>(W+)<\/text>/g)].map(match => match[1]);
    assert.equal(wideLines.join(""), name + name);
    assert.ok(wideLines.every(line => line.length <= (width === 390 ? 22 : 35)));
    const digits = [...svg.matchAll(/<text[^>]*>([\d.]+(?: cm)?)<\/text>/g)].map(match => match[1]);
    assert.ok(digits.join("").includes(value));
    assert.doesNotMatch(svg, /NaN|undefined/);
  }
});

test("uniform plot framing includes edge impacts without changing local coordinates or ring radii", () => {
  for (const faceType of ["full_face", "six_ring", "triple_face"]) {
    const report = createGroupingExport({ ...round, faceType, arrows: [
      { id: "a", end: 1, arrow: 1, score: "M", plot: { x: .65, y: .2, faceIndex: 0 } },
      { id: "b", end: 1, arrow: 2, score: "M", plot: { x: -.7, y: -.3, faceIndex: 2 } },
    ] });
    for (const width of [390, 800]) {
      const { svg, layout } = renderGroupingExport(report, { width });
      const transform = svg.match(/data-target-plot="true" transform="translate\(([^ ]+) ([^)]+)\) scale\(([^)]+)\)"/);
      const [tx, ty, scale] = transform.slice(1).map(Number);
      const clip = svg.match(/<clipPath[^>]*><rect x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"/);
      const [x, y, w, h] = clip.slice(1).map(Number);
      for (const arrow of report.grouping.arrows) {
        const localY = (faceType === "triple_face" ? [-110, 0, 110][arrow.faceIndex] : 0) + arrow.y * 100;
        assert.ok(arrow.x * 100 * scale + tx > x && arrow.x * 100 * scale + tx < x + w);
        assert.ok(localY * scale + ty > y && localY * scale + ty < y + h);
      }
      assert.equal(h, layout.targetHeight);
      assert.match(svg, /r="10" fill="#f5cf3d"/);
      assert.ok(svg.includes('cx="65" cy="' + (faceType === "triple_face" ? -90 : 20) + '" r="1.8"'));
    }
  }
});

test("partial and completed Rounds retain visible centre/spread with compact pixel-sized indicators", () => {
  for (const width of [390, 800]) for (const faceType of ["full_face", "six_ring", "triple_face"]) {
    for (const complete of [false, true]) for (const offset of [-.2, 0, .2]) {
      const input = { ...round, faceType, ends: complete ? 1 : 6, arrowsPerEnd: 4, arrows: [
        [-.16, -.12], [.17, -.12], [.12, .13], [-.12, .14],
      ].map(([x, y], i) => ({ id: String(i), end: 1, arrow: i + 1, score: "9", plot: { x: x + offset, y, ...(faceType === "triple_face" ? { faceIndex: 1 } : {}) } })) };
      const report = createGroupingExport(input), before = structuredClone(report);
      const { svg } = renderGroupingExport(report, { width });
      assert.equal((svg.match(/data-main-group-area=/g) ?? []).length, 1);
      const area = svg.match(/<g data-main-group-area="\d+"[^>]*>([\s\S]*?)<\/g>/)[1];
      assert.match(area, /stroke="#ffffff"/);
      assert.match(area, /fill-opacity=".16"/);
      const scale = Number(svg.match(/data-target-plot="true" transform="translate\([^)]+\) scale\(([^)]+)\)"/)[1]);
      const marker = svg.match(/<g data-main-group-centre="\d+"[^>]*>([\s\S]*?)<\/g>/)[1];
      const coordinates = marker.match(/<path d="([^"]+)"/)[1].match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/g).map(Number);
      const pixelWidth = (coordinates[5] - coordinates[0]) * scale;
      assert.ok(Math.abs(pixelWidth - (width === 390 ? 16 : 20)) < 1e-8);
      const markerCircle = marker.match(/<circle cx="([^"]+)" cy="([^"]+)" r="([^"]+)"/).slice(1).map(Number);
      assert.equal(markerCircle[0], report.mainGroup.metrics.centreX * 100);
      assert.equal(markerCircle[1], report.mainGroup.metrics.centreY * 100);
      assert.ok(Math.abs(markerCircle[2] * scale - 3) < 1e-8);
      const average = svg.match(/data-average-impact="\d+"[^>]*><circle[^>]*r="([^"]+)"/);
      assert.ok(Math.abs(Number(average[1]) * scale - 1.5) < 1e-8);
      assert.deepEqual(report, before);
    }
  }
});
