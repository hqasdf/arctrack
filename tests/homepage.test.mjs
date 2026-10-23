import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import * as THREE from "three";
import * as motion from "../src/features/home/scene-motion.ts";
import * as scoring from "@arc-track/core/scoring";

const require = createRequire(import.meta.url);
const source = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const compile = text => ts.transpileModule(text, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

test("scroll choreography is continuous, bounded and reversible, including refreshes mid-story", () => {
  assert.equal(motion.storyProgress(-100, 0, 3000, 1000), 0);
  assert.equal(motion.storyProgress(1000, 0, 3000, 1000), 0.5);
  assert.equal(motion.storyProgress(10000, 0, 3000, 1000), 1);
  assert.equal(motion.storyProgress(0, 0, 1000, 1000), 0);
  for (const mobile of [false, true]) {
    let previous = motion.scenePose(0, mobile);
    for (let i = 1; i <= 1000; i++) {
      const next = motion.scenePose(i / 1000, mobile);
      for (const key of Object.keys(next)) {
        assert.ok(Number.isFinite(next[key]));
        assert.ok(Math.abs(next[key] - previous[key]) < .02, `${key} must not jump`);
      }
      previous = next;
    }
    assert.deepEqual(motion.scenePose(-1, mobile), motion.scenePose(0, mobile));
    assert.deepEqual(motion.scenePose(2, mobile), motion.scenePose(1, mobile));
    assert.deepEqual(motion.scenePose(.37, mobile), motion.scenePose(.37, mobile));
  }
  assert.ok(motion.scenePose(0, true).cameraZ > motion.scenePose(0, false).cameraZ);
  assert.equal(motion.initialPixelRatio(3, false), 1.6);
  assert.equal(motion.initialPixelRatio(3, true), 1.25);
  assert.equal(motion.initialPixelRatio(3, false, true), 1);
});

test("sample End interaction uses core scoring and never writes user data", async () => {
  const text = await source("src/features/home/precision-demo.tsx");
  let selected = 0;
  let instance;
  const exports = {};
  new Function("require", "exports", compile(text))(name => {
    if (name === "react") return { useState: () => [selected, value => { selected = value; }] };
    if (name === "react/jsx-runtime") return require(name);
    if (name === "@arc-track/core/scoring") return scoring;
    if (name.endsWith(".css")) return { __esModule: true, default: {} };
    throw new Error(name);
  }, exports);
  instance = exports.PrecisionDemo();
  const first = renderToStaticMarkup(instance);
  assert.match(first, /60<span> \/ 60/);
  assert.match(first, /10\.00/);
  assert.match(first, /Sample End 1 target: 10, 10, 10, 10, 10, 10/);
  assert.match(first, /Illustrative data/);
  const buttons = [];
  function visit(node) {
    if (!React.isValidElement(node)) return;
    if (node.type === "button") buttons.push(node);
    React.Children.forEach(node.props.children, visit);
  }
  function assertTenRingPlots(node) {
    if (!React.isValidElement(node)) return;
    if (node.type === "circle" && node.props.cx !== undefined) {
      const plot = { x: node.props.cx / 100, y: node.props.cy / 100 };
      assert.ok(Math.hypot(plot.x, plot.y) + Number(node.props.r) / 100 < .1, "the whole impact marker fits inside the visible 10-ring");
      assert.equal(scoring.scoreFromPlot(plot), "10");
    }
    React.Children.forEach(node.props.children, assertTenRingPlots);
  }
  assertTenRingPlots(instance);
  visit(instance);
  assert.equal(buttons.length, 2);
  buttons[1].props.onClick();
  const secondInstance = exports.PrecisionDemo();
  assertTenRingPlots(secondInstance);
  const second = renderToStaticMarkup(secondInstance);
  assert.match(second, /60<span> \/ 60/);
  assert.match(second, /10\.00/);
  assert.match(second, /Sample End 2 target: 10, 10, 10, 10, 10, 10/);
  assert.notEqual(first, second);
  assert.match(second, /aria-pressed="true">End 2/);
  buttons[0].props.onClick();
  assert.equal(renderToStaticMarkup(exports.PrecisionDemo()), first);
  assert.doesNotMatch(text, /supabase|fetch\(|localStorage|sessionStorage|server action/i);
});

test("portrait phone and tablet camera keeps the complete target face in frame", () => {
  for (const [width, height] of [[320, 740], [390, 844], [430, 932], [768, 1024], [820, 1180]]) {
    for (const progress of [0, .25, .5, .75, 1]) {
      const pose = motion.scenePose(progress, true, width / height);
      const camera = new THREE.PerspectiveCamera(36, width / height, .1, 40);
      camera.position.set(pose.cameraX, pose.cameraY, pose.cameraZ);
      camera.lookAt(pose.lookX, pose.lookY, 0);
      camera.updateMatrixWorld();
      const target = new THREE.Object3D();
      target.position.set(pose.targetX, pose.targetY, 0);
      target.rotation.y = pose.targetRotation;
      target.updateMatrixWorld();
      for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 12) {
        const point = new THREE.Vector3(Math.cos(angle) * 1.25, Math.sin(angle) * 1.25, 0).applyMatrix4(target.matrixWorld).project(camera);
        assert.ok(Math.abs(point.x) < 1 && Math.abs(point.y) < 1, `${width}x${height} at ${progress}: target must fit`);
      }
    }
  }
});

function sceneHarness(compiled, { reduced = false, scrollY = 0, supported = true } = {}) {
  const windowListeners = new Map(), documentListeners = new Map(), canvasListeners = new Map();
  const media = [];
  const observers = [];
  let activeLoop = null, renderCount = 0, disposed = false, failed = false;
  let geometryDisposals = 0, materialDisposals = 0;
  let cameraPosition;
  const arrowPositions = [];
  class Renderer {
    setClearColor() {} setPixelRatio() {} setSize() {}
    compileAsync() { return Promise.resolve(); }
    render(scene, camera) {
      renderCount++;
      cameraPosition = camera.position.clone();
      if (renderCount === 1) scene.traverse(object => {
        if (object.isGroup && object.children.some(child => child.geometry?.type === "ConeGeometry")) {
          arrowPositions.push(object.position.clone());
        }
        object.geometry?.addEventListener("dispose", () => geometryDisposals++);
        object.material?.addEventListener("dispose", () => materialDisposals++);
      });
    }
    setAnimationLoop(callback) { activeLoop = callback; }
    dispose() { disposed = true; }
    forceContextLoss() {}
  }
  class Observer {
    constructor(callback) { this.callback = callback; this.disconnected = false; observers.push(this); }
    observe() {} disconnect() { this.disconnected = true; }
  }
  const canvas = {
    getContext: () => supported ? {} : null,
    dataset: {}, parentElement: {}, getBoundingClientRect: () => ({ width: 1200, height: 800 }),
    addEventListener: (event, fn) => canvasListeners.set(event, fn),
    removeEventListener: event => canvasListeners.delete(event),
  };
  const document = {
    visibilityState: "visible", createElement: () => ({ getContext: () => null }),
    addEventListener: (event, fn) => documentListeners.set(event, fn),
    removeEventListener: event => documentListeners.delete(event),
  };
  const window = {
    scrollY, innerHeight: 800,
    addEventListener: (event, fn, options) => { assert.equal(options.passive, true); windowListeners.set(event, fn); },
    removeEventListener: event => windowListeners.delete(event),
  };
  const matchMedia = query => {
    const value = { matches: query.includes("reduced") ? reduced : false, addEventListener: (_, fn) => { value.listener = fn; }, removeEventListener: () => { value.listener = null; } };
    media.push(value);
    return value;
  };
  const exports = {};
  new Function("require", "exports", "window", "document", "navigator", "matchMedia", "IntersectionObserver", "ResizeObserver", "devicePixelRatio", compiled)(
    name => name === "three" ? { ...THREE, WebGLRenderer: Renderer } : motion, exports,
    window, document, {}, matchMedia, Observer, Observer, 2,
  );
  const cleanup = exports.mountArcheryScene(canvas, { getBoundingClientRect: () => ({ top: -window.scrollY, height: 2400 }) }, () => { failed = true; });
  return {
    cleanup, canvas, document, window, media, observers, windowListeners, documentListeners, canvasListeners,
    frame: time => activeLoop?.(time),
    get state() { return { activeLoop, renderCount, disposed, failed, geometryDisposals, materialDisposals, cameraPosition, arrowPositions }; },
  };
}

const sceneSource = await source("src/features/home/archery-scene.ts");
const sceneCompiled = compile(sceneSource);

test("all three cinematic Arrow impacts fit inside the actual visual 10-ring", async () => {
  const scene = sceneHarness(sceneCompiled, { reduced: true });
  await Promise.resolve();
  scene.frame(performance.now());
  const positions = scene.state.arrowPositions;
  assert.equal(positions.length, 3);
  assert.equal(new Set(positions.map(point => `${point.x},${point.y}`)).size, 3);
  for (const point of positions) {
    assert.ok(Math.hypot(point.x, point.y) + .014 < 1.16 / 10);
    assert.equal(scoring.scoreFromPlot({ x: point.x / 1.16, y: point.y / 1.16 }), "10");
  }
  scene.cleanup();
});

test("Coach Dashboard illustration is crawlable, labelled sample data and contains existing capabilities", async () => {
  const text = await source("src/features/home/coach-showcase.tsx");
  const exports = {};
  new Function("require", "exports", compile(text))(name => {
    if (name === "react/jsx-runtime") return require(name);
    if (name === "next/link") return { __esModule: true, default: ({ children, ...props }) => React.createElement("a", props, children) };
    if (name === "@/components/ui/icon") return { Icon: () => null };
    if (name.endsWith(".css")) return { __esModule: true, default: {} };
    throw new Error(name);
  }, exports);
  const html = renderToStaticMarkup(exports.CoachShowcase());
  for (const content of ["Coach Dashboard", "Team performance", "Athlete overview", "Recent Sessions", "Performance over time", "Training Plan progress", "Session feedback", "sample data", "Archer 01", "Archer 02"]) assert.ok(html.includes(content), content);
  assert.match(html, /id="coaching"/);
  assert.match(html, /role="meter"[^>]*aria-valuenow="450"/);
  assert.match(html, /href="\/sign-up"/);
  assert.doesNotMatch(text, /use client|useEffect|useState|supabase|fetch\(|requestAnimationFrame/);
});

test("WebGL loop rests after settling, resumes on scroll and pauses offscreen or hidden", async () => {
  const scene = sceneHarness(sceneCompiled);
  assert.equal(scene.state.activeLoop, null);
  await Promise.resolve();
  scene.frame(performance.now() + 2000);
  assert.equal(scene.canvas.dataset.rendered, "true");
  assert.equal(scene.state.activeLoop, null);
  scene.window.scrollY = 1000;
  scene.windowListeners.get("scroll")();
  assert.ok(scene.state.activeLoop);
  scene.document.visibilityState = "hidden";
  scene.documentListeners.get("visibilitychange")();
  assert.equal(scene.state.activeLoop, null);
  scene.document.visibilityState = "visible";
  scene.documentListeners.get("visibilitychange")();
  assert.ok(scene.state.activeLoop);
  scene.observers[0].callback([{ isIntersecting: false }]);
  assert.equal(scene.state.activeLoop, null);
  scene.observers[0].callback([{ isIntersecting: true }]);
  assert.ok(scene.state.activeLoop);
  scene.cleanup();
  assert.equal(scene.state.activeLoop, null);
  assert.equal(scene.state.disposed, true);
  assert.ok(scene.state.geometryDisposals > 15);
  assert.ok(scene.state.materialDisposals > 10);
  assert.equal(scene.windowListeners.size + scene.documentListeners.size + scene.canvasListeners.size, 0);
  assert.ok(scene.observers.every(observer => observer.disconnected));
  assert.ok(scene.media.every(query => !query.listener));
});

test("reduced motion is static, mid-story reload is correctly framed, context loss activates fallback", async () => {
  const reduced = sceneHarness(sceneCompiled, { reduced: true, scrollY: 1200 });
  await Promise.resolve();
  reduced.frame(performance.now());
  assert.equal(reduced.state.activeLoop, null);
  const position = reduced.state.cameraPosition;
  reduced.window.scrollY = 1600;
  reduced.windowListeners.get("scroll")();
  reduced.frame(performance.now() + 16);
  assert.deepEqual(reduced.state.cameraPosition, position);
  reduced.cleanup();

  const restored = sceneHarness(sceneCompiled, { scrollY: 800 });
  await Promise.resolve();
  restored.frame(performance.now());
  assert.equal(restored.state.cameraPosition.z, motion.scenePose(.5, false).cameraZ);
  restored.canvasListeners.get("webglcontextlost")({ preventDefault() {} });
  assert.equal(restored.state.failed, true);
  assert.equal(restored.state.activeLoop, null);
  assert.equal(restored.canvas.dataset.rendered, undefined);
  assert.equal(restored.state.disposed, true);
  assert.equal(restored.windowListeners.size + restored.documentListeners.size + restored.canvasListeners.size, 0);
  restored.cleanup();
});

test("leaving the homepage during shader preparation cannot restart a retired renderer", async () => {
  const scene = sceneHarness(sceneCompiled);
  scene.cleanup();
  await Promise.resolve();
  assert.equal(scene.state.activeLoop, null);
  assert.equal(scene.state.renderCount, 0);
  assert.equal(scene.state.disposed, true);
});

test("unsupported WebGL takes the static fallback without starting a renderer or listeners", () => {
  const scene = sceneHarness(sceneCompiled, { supported: false });
  assert.equal(scene.state.failed, true);
  assert.equal(scene.state.activeLoop, null);
  assert.equal(scene.state.renderCount, 0);
  assert.equal(scene.windowListeners.size + scene.documentListeners.size + scene.canvasListeners.size, 0);
  assert.equal(scene.observers.length, 0);
  scene.cleanup();
});
