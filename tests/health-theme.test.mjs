import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const css = await readFile(new URL("../src/features/health/components/health.module.css", import.meta.url), "utf8");
const declarations = (block) => Object.fromEntries([...block.matchAll(/([\w-]+):\s*([^;]+);/g)].map((match) => [match[1], match[2].trim()]));
const light = declarations(css.match(/^\.dashboard \{([^}]+)\}/)[1]);
const dark = declarations(css.match(/:global\(:root\[data-theme="dark"\]\) \.dashboard \{([^}]+)\}/)[1]);
const system = declarations(css.match(/:global\(:root\[data-theme="system"\]\) \.dashboard \{([^}]+)\}/)[1]);

test("Health preserves approved light surfaces and metric palette", () => {
  for (const [token, value] of Object.entries({
    background: "#f6f8fb", surface: "#ffffff", text: "#243443", muted: "#637384", border: "#e5eaf0",
    blue: "#3569b7", green: "#287c65", coral: "#c25c60", amber: "#94661d", lavender: "#7764b1",
    "lavender-tint": "#f0ecf9", "coral-tint": "#fbeded", "amber-tint": "#faf1dd", "blue-tint": "#eaf1fc", "green-tint": "#e7f4ee",
  })) assert.equal(light[`--health-${token}`], value, token);
  assert.equal(light["color-scheme"], "light");
});

test("Health dark appearance reuses the authenticated website surfaces and text", () => {
  for (const token of ["background", "surface", "text", "muted", "border"]) {
    assert.equal(dark[`--health-${token}`], `var(--color-${token})`);
  }
  assert.equal(dark["color-scheme"], "dark");
  for (const tone of ["blue", "green", "coral", "amber", "lavender"]) {
    assert.equal(dark[`--health-${tone}`], `color-mix(in srgb, ${light[`--health-${tone}`]} 50%, var(--color-text))`);
    assert.match(dark[`--health-${tone}-tint`], /var\(--health-surface\)/);
  }
});

test("System dark matches explicit dark, only inside the operating-system dark media query", () => {
  assert.deepEqual(system, dark);
  assert.match(css, /@media \(prefers-color-scheme: dark\) \{\s*:global\(:root\[data-theme="system"\]\) \.dashboard/);
  // A light OS uses the unchanged base palette; manually selected Light cannot match these selectors.
  assert.doesNotMatch(css, /data-theme="light"/);
});

test("Health appearance overrides change only colour tokens and native control colour scheme", () => {
  for (const property of Object.keys(dark)) {
    assert.ok(property === "color-scheme" || property.startsWith("--health-"), property);
  }
  for (const property of Object.keys(light).filter((name) => name.startsWith("--health-"))) {
    assert.ok(property in dark, `missing dark override: ${property}`);
  }
  // Chart and control colours must follow tokens, including SVG and missing-stage patterns.
  const componentRules = css.slice(css.indexOf(".dashboard h1"), css.indexOf("/* Follow"));
  assert.doesNotMatch(componentRules, /#[\da-f]{3,8}\b|rgba?\(/i);
  for (const name of ["grid", "sleep-deep", "sleep-light", "sleep-rem", "unknown-stripe", "unknown-background", "skeleton", "wellness-background", "selected-background"]) {
    assert.ok(componentRules.includes(`var(--health-${name})`), name);
  }
  assert.match(componentRules, /\.svgLabel \{ fill: var\(--health-muted\)/);
  assert.match(componentRules, /\.info p \{[^}]+background: var\(--health-surface\)/);
  assert.match(componentRules, /\.point \{ fill: var\(--tone\); stroke: var\(--health-surface\)/);
  assert.match(componentRules, /:focus-visible/);
  assert.match(componentRules, /\.wellness \.eyebrow \{ color: var\(--health-wellness-text\)/);
});

test("Health theme integration needs no provider, new preference, data read or component remount", async () => {
  for (const file of ["health-dashboard.tsx", "health-cards.tsx", "health-chart.tsx"]) {
    const source = await readFile(new URL(`../src/features/health/components/${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /matchMedia|localStorage|ThemeProvider|useTheme|data-theme/);
  }
  const theme = await readFile(new URL("../src/styles/theme.css", import.meta.url), "utf8");
  assert.match(theme, /:root:not\(\[data-theme\]\) \[data-authenticated-theme\] \{ visibility: hidden;/);
});
