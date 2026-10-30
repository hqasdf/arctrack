// Report-only until repeated Linux CI measurements establish a stable baseline.
const config = {
  routes: ['/', '/sign-in', '/privacy'],
  runs: 3,
  port: 4173,
  output: '.verification/performance',
  baseline: 'performance-baseline.json',
  warningMultiplier: 1.25,
};
export default config;
