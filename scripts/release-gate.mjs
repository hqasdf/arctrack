import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const validationJobs = ['web', 'mobile', 'core', 'maintenance'];

/** Accept only explicit, successful validation for every affected scope. */
export function verifyReleaseGate(needs) {
  if (!needs || needs.changes?.result !== 'success') throw Error('Scope detection did not succeed');
  const scope = needs.changes.outputs;
  if (!scope || scope.maintenance !== 'true') throw Error('Every commit requires maintenance validation');
  for (const job of validationJobs) {
    if (scope[job] !== 'true' && scope[job] !== 'false') throw Error(`Missing or invalid scope: ${job}`);
    const result = needs[job]?.result;
    if (scope[job] === 'true' ? result !== 'success' : result !== 'success' && result !== 'skipped') {
      throw Error(`Validation did not satisfy release-gate: ${job}`);
    }
  }
  return true;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    verifyReleaseGate(JSON.parse(process.env.VALIDATION_NEEDS ?? 'null'));
    console.log('release-gate: all applicable validations succeeded');
  } catch (error) {
    console.error(`release-gate: ${error instanceof SyntaxError ? 'invalid validation results' : error.message}`);
    process.exitCode = 1;
  }
}
