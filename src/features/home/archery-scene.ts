import * as THREE from "three";
import { initialPixelRatio, scenePose, storyProgress } from "./scene-motion";

export function mountArcheryScene(canvas: HTMLCanvasElement, story: HTMLElement, onFailure: () => void) {
  const mobileQuery = matchMedia("(max-width: 700px), (orientation: portrait)");
  const motionQuery = matchMedia("(prefers-reduced-motion: reduce)");
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  const contextOptions = { antialias: !mobileQuery.matches, alpha: true, powerPreference: "low-power" as const };
  const gl = canvas.getContext("webgl2", contextOptions) as WebGL2RenderingContext | null;
  if (!gl) {
    onFailure();
    return () => {};
  }
  const renderer = new THREE.WebGLRenderer({ ...contextOptions, canvas, context: gl });
  renderer.setClearColor(0x181715, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.25;
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x181715, 0.045);
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 40);
  const geometry = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  const trackGeometry = <T extends THREE.BufferGeometry>(value: T): T => { geometry.add(value); return value; };
  const trackMaterial = <T extends THREE.Material>(value: T): T => { materials.add(value); return value; };
  const standard = (color: number, roughness = 0.65, metalness = 0.0) => trackMaterial(new THREE.MeshStandardMaterial({ color, roughness, metalness }));
  const mesh = (shape: THREE.BufferGeometry, material: THREE.Material, parent: THREE.Object3D, x = 0, y = 0, z = 0) => {
    const object = new THREE.Mesh(shape, material);
    object.position.set(x, y, z);
    parent.add(object);
    return object;
  };
  const target = new THREE.Group();
  scene.add(target);
  scene.add(new THREE.HemisphereLight(0xf6e6d2, 0x131d28, 2.0));
  const key = new THREE.DirectionalLight(0xffdec0, 4);
  key.position.set(-3, 5, 6);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xa8c4da, 3);
  rim.position.set(5, 1, -3);
  scene.add(rim);
  const fill = new THREE.PointLight(0xe6b895, 12, 12);
  fill.position.set(-2, 0, 4);
  scene.add(fill);

  const carbon = standard(0x25282c, 0.35, 0.6);
  const brass = standard(0xb79368, 0.35, 0.6);
  const wood = standard(0x564133, 0.85);
  const straw = standard(0x796347, 1);
  const cylinder = trackGeometry(new THREE.CylinderGeometry(1.22, 1.22, 0.27, 80));
  mesh(cylinder, straw, target, 0, 0, -0.14).rotation.x = Math.PI / 2;
  const rimGeometry = trackGeometry(new THREE.TorusGeometry(1.22, 0.027, 8, 80));
  mesh(rimGeometry, brass, target, 0, 0, 0.005);
  const legShape = trackGeometry(new THREE.BoxGeometry(0.085, 2.2, 0.1));
  mesh(legShape, wood, target, -0.64, -0.7, -0.3).rotation.z = -0.23;
  mesh(legShape, wood, target, 0.64, -0.7, -0.3).rotation.z = 0.23;
  const brace = trackGeometry(new THREE.BoxGeometry(1.5, 0.075, 0.12));
  mesh(brace, wood, target, 0, -1.07, -0.28);

  // The existing target-face palette; concentric geometry is decorative only.
  const ringColors = [0xf4f1e9, 0xf4f1e9, 0x202020, 0x202020, 0x49a4cf, 0x49a4cf, 0xe65a55, 0xe65a55, 0xf5cf3d, 0xf5cf3d];
  const lineMaterial = trackMaterial(new THREE.LineBasicMaterial({ color: 0x332d24, transparent: true, opacity: 0.55 }));
  ringColors.forEach((color, i) => {
    const radius = 1.16 * (1 - i / 10);
    const z = 0.012 + i * 0.001;
    mesh(trackGeometry(new THREE.CircleGeometry(radius, 96)), standard(color, 0.94), target, 0, 0, z);
    const points = Array.from({ length: 97 }, (_, n) => new THREE.Vector3(Math.cos(n / 96 * Math.PI * 2) * radius, Math.sin(n / 96 * Math.PI * 2) * radius, z + 0.002));
    target.add(new THREE.Line(trackGeometry(new THREE.BufferGeometry().setFromPoints(points)), lineMaterial));
  });
  const xRing = trackGeometry(new THREE.RingGeometry(0.056, 0.058, 48));
  mesh(xRing, trackMaterial(new THREE.MeshBasicMaterial({ color: 0x55421a })), target, 0, 0, 0.027);

  // Carbon shafts, metal points, three fletchings and nocks share geometry/materials.
  const shaftShape = trackGeometry(new THREE.CylinderGeometry(0.009, 0.009, 1.5, 8));
  const tipShape = trackGeometry(new THREE.ConeGeometry(0.014, 0.07, 8));
  const nockShape = trackGeometry(new THREE.CylinderGeometry(0.013, 0.013, 0.06, 8));
  const vaneShape = trackGeometry(new THREE.BoxGeometry(0.055, 0.2, 0.003));
  const vaneMaterial = standard(0xe6b895, 0.55);
  function makeArrow(x: number, y: number) {
    const arrow = new THREE.Group();
    mesh(shaftShape, carbon, arrow, 0, 0, 0.79).rotation.x = Math.PI / 2;
    mesh(tipShape, brass, arrow, 0, 0, 0.015).rotation.x = -Math.PI / 2;
    mesh(nockShape, vaneMaterial, arrow, 0, 0, 1.54).rotation.x = Math.PI / 2;
    for (let i = 0; i < 3; i++) {
      const vane = mesh(vaneShape, vaneMaterial, arrow, 0, 0, 1.34);
      vane.rotation.set(Math.PI / 2, i * Math.PI * 2 / 3, 0);
    }
    arrow.position.set(x, y, 0.04);
    arrow.rotation.set(-0.04, -0.08, 0);
    target.add(arrow);
    return arrow;
  }
  makeArrow(0.075, 0.01);
  makeArrow(0.035, 0.065);
  const travellingArrow = makeArrow(-0.015, 0.08);
  const groupMaterial = trackMaterial(new THREE.MeshBasicMaterial({ color: 0xe6b895, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
  mesh(trackGeometry(new THREE.RingGeometry(0.064, 0.067, 64)), groupMaterial, target, 0.0317, 0.0517, 0.045);
  const crosshairShape = trackGeometry(new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-0.0083, 0.0517, 0.048), new THREE.Vector3(0.0717, 0.0517, 0.048),
    new THREE.Vector3(0.0317, 0.0117, 0.048), new THREE.Vector3(0.0317, 0.0917, 0.048),
  ]));
  const groupLines = trackMaterial(new THREE.LineBasicMaterial({ color: 0xffe1c1, transparent: true, opacity: 0 }));
  target.add(new THREE.LineSegments(crosshairShape, groupLines));

  const floor = mesh(trackGeometry(new THREE.PlaneGeometry(80, 80)), standard(0x1c1b19, 1), scene, 0, -1.85, 0);
  floor.rotation.x = -Math.PI / 2;
  // One tiny procedural shadow texture instead of dynamic shadow-map rendering.
  const shadowCanvas = document.createElement("canvas");
  shadowCanvas.width = shadowCanvas.height = 64;
  const context = shadowCanvas.getContext("2d");
  if (context) {
    const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, "rgba(0,0,0,0.6)");
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 64, 64);
    const texture = new THREE.CanvasTexture(shadowCanvas);
    textures.add(texture);
    const shadow = mesh(trackGeometry(new THREE.PlaneGeometry(5, 3)), trackMaterial(new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false })), scene, 1.6, -1.84, 0);
    shadow.rotation.x = -Math.PI / 2;
  }
  const laneMaterial = trackMaterial(new THREE.LineBasicMaterial({ color: 0x80705b, transparent: true, opacity: 0.12 }));
  for (const x of [-4, -1, 2, 5]) {
    scene.add(new THREE.Line(trackGeometry(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x, -1.83, 8), new THREE.Vector3(x, -1.83, -18)])), laneMaterial));
  }

  let disposed = false, inView = true, running = false, lost = false, ready = false;
  let top = 0, height = 1, viewport = 1, current = 0, targetProgress = 0;
  let previousTime = 0, introStart = performance.now(), slowFrames = 0, sampledFrames = 0;
  let dpr = initialPixelRatio(devicePixelRatio, mobileQuery.matches, connection?.saveData);
  const look = new THREE.Vector3();

  function renderFrame(time: number) {
    if (disposed || lost) return;
    const delta = previousTime ? Math.min(64, time - previousTime) : 16;
    previousTime = time;
    current += (targetProgress - current) * (1 - Math.exp(-delta / 90));
    if (motionQuery.matches) current = 0;
    const pose = scenePose(current, mobileQuery.matches, camera.aspect);
    const intro = motionQuery.matches ? 0 : Math.max(0, 1 - (time - introStart) / 1600);
    camera.position.set(pose.cameraX + intro * 0.22, pose.cameraY + intro * 0.1, pose.cameraZ + intro * 0.65);
    look.set(pose.lookX, pose.lookY, 0);
    camera.lookAt(look);
    target.position.set(pose.targetX, pose.targetY, 0);
    target.rotation.y = pose.targetRotation;
    travellingArrow.position.z = motionQuery.matches ? 0.04 : 0.04 + (1 - pose.arrowTravel) * 3.1;
    groupMaterial.opacity = pose.groupingOpacity;
    groupLines.opacity = pose.groupingOpacity;
    renderer.render(scene, camera);
    // Conservative one-way quality reduction, sampled only during active movement.
    if (delta > 28) slowFrames++;
    sampledFrames++;
    if (sampledFrames === 90 && slowFrames > 30 && dpr > 1) {
      dpr = 1;
      renderer.setPixelRatio(dpr);
    }
    canvas.dataset.rendered = "true";
    if (motionQuery.matches || (Math.abs(targetProgress - current) < 0.0001 && intro === 0)) stop();
  }
  function stop() {
    renderer.setAnimationLoop(null);
    running = false;
    previousTime = 0;
  }
  function start() {
    if (ready && !running && !disposed && !lost && inView && document.visibilityState !== "hidden") {
      running = true;
      renderer.setAnimationLoop(renderFrame);
    }
  }
  function scroll() {
    targetProgress = storyProgress(window.scrollY, top, height, viewport);
    start();
  }
  function resize() {
    const bounds = canvas.getBoundingClientRect();
    const storyBounds = story.getBoundingClientRect();
    top = storyBounds.top + window.scrollY;
    height = storyBounds.height;
    viewport = window.innerHeight;
    camera.aspect = bounds.width / Math.max(1, bounds.height);
    camera.updateProjectionMatrix();
    dpr = Math.min(dpr, initialPixelRatio(devicePixelRatio, mobileQuery.matches, connection?.saveData));
    renderer.setPixelRatio(dpr);
    renderer.setSize(bounds.width, bounds.height, false);
    scroll();
  }
  function visibility() { if (document.visibilityState === "hidden") stop(); else start(); }
  function motion() { introStart = -10000; scroll(); }
  function contextLost(event: Event) {
    event.preventDefault();
    lost = true;
    stop();
    delete canvas.dataset.rendered;
    cleanup();
    onFailure();
  }
  const observer = new IntersectionObserver(([entry]) => { inView = entry.isIntersecting; if (inView) start(); else stop(); });
  const resizeObserver = new ResizeObserver(resize);
  observer.observe(story);
  resizeObserver.observe(canvas.parentElement!);
  resizeObserver.observe(story);
  window.addEventListener("scroll", scroll, { passive: true });
  window.addEventListener("resize", resize, { passive: true });
  document.addEventListener("visibilitychange", visibility);
  motionQuery.addEventListener("change", motion);
  canvas.addEventListener("webglcontextlost", contextLost);
  resize();
  // A mid-story refresh should open at the correct camera pose immediately.
  current = targetProgress;
  if (targetProgress > 0.01) introStart = -10000;
  // Compile shaders before the first full-size draw instead of stalling a scroll frame.
  void renderer.compileAsync(scene, camera).then(() => {
    if (disposed) return;
    ready = true;
    introStart = targetProgress > 0.01 ? -10000 : performance.now();
    start();
  }).catch(() => {
    if (disposed) return;
    cleanup();
    onFailure();
  });
  function cleanup() {
    if (disposed) return;
    disposed = true;
    stop();
    observer.disconnect();
    resizeObserver.disconnect();
    window.removeEventListener("scroll", scroll);
    window.removeEventListener("resize", resize);
    document.removeEventListener("visibilitychange", visibility);
    motionQuery.removeEventListener("change", motion);
    canvas.removeEventListener("webglcontextlost", contextLost);
    geometry.forEach(value => value.dispose());
    materials.forEach(value => value.dispose());
    textures.forEach(value => value.dispose());
    renderer.dispose();
    renderer.forceContextLoss();
  }
  return cleanup;
}
