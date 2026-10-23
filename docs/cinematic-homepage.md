# Public cinematic homepage

The homepage at `/` is a public, statically rendered introduction to Arc Track. It replaces only the former root redirect. Sign-in, callback destinations and authenticated Sessions still use the existing authentication flow. No identity reader or Supabase query runs on the homepage.

## Implementation

- `src/app/page.tsx` contains the server-rendered content and navigation. The page introduces scoring, grouping, Round Insights, Sessions, Training Plans, Analytics and the Coach's Workspace using capabilities verified in the application source.
- `src/features/home/cinematic-scene.tsx` dynamically imports the renderer. A CSS target illustration remains available while loading or when WebGL is unavailable. SEO content and navigation do not depend on rendering or JavaScript.
- `archery-scene.ts` uses Three.js directly. All target, stand, Arrow and lane geometry is procedural. Materials, geometry and the small procedural shadow texture are explicitly disposed. No external artwork, commercial model, texture download, animation framework or postprocessing dependency is used.
- `scene-motion.ts` defines a continuous camera path. Native scroll updates a numeric target; a single Three.js animation loop interpolates toward it without React state updates. There is no scroll hijacking or custom scrolling engine.
- `precision-demo.tsx` is an explicitly labelled, local sample. Its End selector uses `@arc-track/core/scoring` for scores, totals, averages and X counts. It never reads or writes user records. The Sessions and Training Plan illustration is also labelled sample data.
- `coach-showcase.tsx` is a server-rendered HTML/SVG Coach Dashboard illustration after the training section. It shows active athletes, recent Sessions, a labelled average/Arrow trend, weekly Training Plan progress and Session-specific feedback. All data is explicitly illustrative. Coach access to athlete scoring is described as read-only; this preview adds no authenticated reader, animation loop or client state.
- `home.module.css` scopes the warm graphite, cream and peach presentation to the homepage. It uses the existing website dark palette, retains the target-face colours and does not alter authenticated themes or public auth styling.

The scene pauses after the introductory camera settles, after scroll interpolation settles, while the document is hidden and when the story is offscreen. Device pixel ratio is capped at 1.6 for landscape desktop and 1.25 for narrow/portrait layouts, with a cap of 1 for Data Saver. Sustained slow frames permit one conservative reduction to 1. There are no dynamic shadow maps. Shader programs are prepared with `compileAsync` before the first full-size draw. Portrait layouts use a separate, aspect-aware camera distance.

Reduced motion keeps the camera and Arrows static. Context loss and compilation failure dispose the scene immediately and leave the fallback visible. Cleanup is idempotent, and a late compilation result cannot restart a retired renderer.

## Perfect-shot and coaching refinement

All three landed cinematic Arrows are within the existing target's 0.116-unit 10-ring; their distinct positions are (0.075, 0.01), (0.035, 0.065) and (-0.015, 0.08). The decorative grouping outline encloses this cluster and is centred at its arithmetic mean, approximately (0.0317, 0.0517). CSS fallback impacts also sit near the centre. Both interactive sample Ends use six distinct positions inside the visible normalized 0.1-radius 10-ring, outside the shared scorer's X cutoff. Each reports 60/60, a 10.00 average and zero Xs using the unchanged core scorer. Related Session illustrations show 60 points for six Arrows. No actual scoring, target geometry or grouping calculations changed.

The fifth chapter introduces the Coach Dashboard after individual training progress and before the final CTA. The new navigation anchor, introductory copy, closing copy and metadata cover athlete and coach value. Features were checked against the existing Coach Workspace implementation; feedback is described as Session-specific free text, not a structured rubric or automatic diagnosis.

Refinement QA rendered the new section at 320, 390, 430, 768, 820 and 1366 CSS px with no measured horizontal overflow. The sample End selector returned six 10s in the browser, the coaching CTA opened the existing signup page, the real WebGL canvas rendered the landed group, and the browser reported no captured warnings/errors. Screenshots were inspected on desktop and mobile; full virtual tall-view captures can still be limited by the physical browser window.

## SEO and routing

The existing SEO helper and private noindex defaults remain in place. The homepage explicitly overrides its own metadata, has production canonical/Open Graph URLs and is included in the sitemap alongside `/sign-in`, `/privacy` and `/delete-account`. Preview metadata remains noindex, robots disallows preview crawling and preview sitemaps remain empty.

The `Open Sessions` link uses `/sessions`. Anonymous visitors follow its existing redirect to sign-in; authenticated visitors use their normal Sessions page. No new dashboard route is introduced.

## Local validation — 23 October 2026

- Web tests: **261 passed, 0 failed**, including 12 focused homepage/SEO checks.
- Shared-core tests: **107 passed, 0 failed**.
- Web TypeScript, repository lint, production build and `git diff --check`: passed.
- Built-app anonymous HTTP checks: homepage and three other public pages return 200 with consistent robots, canonical and Open Graph metadata; sitemap/robots are valid. Browser and Googlebot user-agents both pass. All five private route categories retain anonymous redirects and private/no-store caching.
- Browser review used Opera with phone (320 and 390 CSS px), portrait tablet (768 and 820), laptop (1366) and large desktop (1920) viewport overrides. Sample interaction, responsive stacking, tablet scene framing, signup navigation and no horizontal overflow were checked. Screenshot capture was intermittent, and the virtual 1920px capture was clipped by the physical browser window; full large-screen capture remains a manual QA item.
- Final local Lighthouse 13.5.0 desktop: Performance **100**, Accessibility **100**, Best Practices **100**, SEO **100**; LCP **0.64 s**, Total Blocking Time **0 ms**, CLS **0**.
- Final local Lighthouse simulated mobile: Performance **94**, Accessibility **100**, Best Practices **100**, SEO **100**; LCP **2.97 s**, Total Blocking Time **77 ms**, CLS **0**. Mobile LCP remains above the 2.5 s engineering target.
- A separate isolated Chrome run with WebGL/WebGL2 disabled retained the public page and CSS target fallback, scored 100 Best Practices/SEO and reported no browser console errors. Full-page capture changes the viewport's orientation and is not reliable for judging the sticky scene's normal viewport composition.

These Lighthouse results are single-run, localhost lab measurements using isolated headless Chrome, not production field data or physical-phone results. Before shader preparation, an earlier simulated-mobile run reported 81 Performance and 530 ms Total Blocking Time. Do not treat comparisons between individual runs as a guarantee for every device.

Actual GPU frame times, sustained desktop/mobile FPS, field INP, GPU memory and repeated-navigation heap profiles have not been measured. Test coverage verifies resource disposal and late-result protection with a mocked renderer, not a real-device memory profiler. Physical touch/trackpad scrolling, low-power phones, iOS Safari, mobile rotation and browser restoration deserve a device pass before release.

## Repeatable checks

```sh
node --experimental-strip-types --test tests/homepage.test.mjs tests/seo.test.mjs
npm test
npm test --workspace @arc-track/core
npm run lint
npm run typecheck
npm run build
# Run the production app on an unused local port, then:
node scripts/check-public-seo.mjs http://127.0.0.1:3101
git diff --check
```

Three.js `0.186.1` and development-only `@types/three` `0.186.0` are pinned. Previously installed dependency versions were not changed. Lighthouse was executed from an ignored tooling cache; it is not an application dependency.

This implementation is local only. No commit, push, production deployment, Android build, Supabase change or Google Play change is part of this work.
