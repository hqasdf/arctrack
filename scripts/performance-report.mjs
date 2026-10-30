import { readdir, stat, readFile, writeFile, mkdir, appendFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const median = values => {
  const sorted = values.filter(Number.isFinite).sort((a,b) => a-b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
};
export function metrics(report) {
  if (report.runtimeError) throw Error(`Lighthouse failed: ${report.runtimeError.code}`);
  const audits = report.audits;
  const resources = audits['resource-summary']?.details?.items ?? [];
  const value = key => Number.isFinite(audits[key]?.numericValue) ? audits[key].numericValue : null;
  const bytes = type => resources.find(item => item.resourceType === type)?.transferSize ?? null;
  const result = { lcpMs: value('largest-contentful-paint'), cls: value('cumulative-layout-shift'),
    tbtMs: value('total-blocking-time'), javascriptBytes: bytes('script'), pageBytes: bytes('total') };
  if (Object.values(result).some(value => value === null)) throw Error('Incomplete Lighthouse measurement');
  return result;
}
export function summarize(samples) {
  return Object.fromEntries(Object.keys(samples[0]).map(key => [key, {
    median: median(samples.map(sample => sample[key])),
    min: Math.min(...samples.map(sample => sample[key])), max: Math.max(...samples.map(sample => sample[key])),
  }]));
}
export function warnings(current, baseline, multiplier = 1.25) {
  const floors = { lcpMs: 500, cls: 0.02, tbtMs: 150, javascriptBytes: 32768, pageBytes: 65536 };
  return Object.entries(current).flatMap(([key, value]) => {
    const previous = baseline?.[key]?.median;
    const limit = Number.isFinite(previous) ? Math.max(previous * multiplier, previous + (floors[key] ?? 0)) : null;
    return limit !== null && value.median > limit ? [`${key}: ${Math.round(value.median * 100) / 100} exceeds warning budget ${Math.round(limit * 100) / 100}`] : [];
  });
}
export async function buildSize(root) {
  const files = [];
  async function visit(path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const next = join(path, entry.name);
      if (entry.isDirectory()) await visit(next);
      else if (/\.(?:js|css)$/.test(entry.name)) files.push({ file: next.slice(root.length + 1).replaceAll('\\','/'), bytes: (await stat(next)).size });
    }
  }
  await visit(join(root, '.next/static'));
  return { javascriptBytes: files.filter(file => file.file.endsWith('.js')).reduce((sum,file) => sum+file.bytes,0),
    cssBytes: files.filter(file => file.file.endsWith('.css')).reduce((sum,file) => sum+file.bytes,0),
    largest: files.sort((a,b) => b.bytes-a.bytes).slice(0,10) };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.cwd(), output = join(root,'.verification/performance');
  await mkdir(output,{recursive:true});
  const report = await buildSize(root);
  report.platform = process.platform;
  report.builder = process.env.PERFORMANCE_BUILD_ENGINE ?? 'turbopack';
  let baseline;
  try { baseline = JSON.parse(await readFile(join(root,'performance-baseline.json'),'utf8')).build; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  report.comparableBaseline = baseline?.platform === report.platform && baseline?.builder === report.builder;
  report.warnings = report.comparableBaseline && report.javascriptBytes > baseline.javascriptBytes * 1.15
    ? ['Static JavaScript grew more than 15% from the recorded baseline. Inspect the largest chunks.'] : [];
  await writeFile(join(output,'build-size.json'),JSON.stringify(report,null,2)+'\n');
  const summary = `### Production static assets\nJavaScript: ${report.javascriptBytes} bytes; CSS: ${report.cssBytes} bytes (uncompressed disk size, not route transfer).\n${report.comparableBaseline ? (report.warnings.join('\n') || 'Within the 15% static JavaScript growth warning budget.') : 'Collect a matching platform/builder baseline before comparing bundle growth.'}\n`;
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY,summary);
}
