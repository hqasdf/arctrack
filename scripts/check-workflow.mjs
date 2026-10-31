import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { parseDocument } from "yaml";

export function validateWorkflow(source) {
  const document = parseDocument(source, { uniqueKeys: true });
  if (document.errors.length) throw Error(document.errors[0].message);
  const workflow = document.toJS();
  if (workflow.permissions?.contents !== "read" || Object.keys(workflow.permissions).length !== 1) throw Error("CI must have read-only repository permission");
  if (Object.keys(workflow.on ?? {}).sort().join() !== "pull_request,push,workflow_dispatch") throw Error("Unexpected CI trigger");
  for (const event of ['pull_request', 'push']) {
    if (workflow.on[event]?.paths || workflow.on[event]?.['paths-ignore'] || workflow.on[event]?.['branches-ignore']) throw Error('Required CI cannot have path or ignored-branch filters');
  }
  if (workflow.on.pull_request?.branches || JSON.stringify(workflow.on.push?.branches) !== '["main"]') throw Error('Validate every PR and every main push');
  const requiredJobs = ['changes', 'web', 'mobile', 'core', 'maintenance', 'release-gate'];
  if (Object.keys(workflow.jobs ?? {}).sort().join() !== [...requiredJobs].sort().join()) throw Error('Every validation job must be explicitly included in the release gate');
  const actions = new Set(["actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803", "actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38", "actions/upload-artifact@bbbca2ddaa5d8feaa63e36b76fdaad77386f024f"]);
  if (/secrets\s*[.[]|\b(?:vercel|wrangler|eas|supabase)\s+(?:deploy|build|update|db|migration)|npm\s+publish/i.test(source)) throw Error("Validation CI must not use secrets or release commands");
  for (const name of requiredJobs) {
    const job = workflow.jobs?.[name];
    if (!job || !job["timeout-minutes"] || job.permissions || job['continue-on-error']) throw Error(`Invalid validation job: ${name}`);
    for (const step of job.steps ?? []) {
      if (step['continue-on-error'] && !(name === 'web' && step.run === 'npm run test:performance')) throw Error('Only advisory performance measurement may ignore failure');
      if (step.uses && !actions.has(step.uses)) throw Error(`Unreviewed action: ${step.uses}`);
      if (step.uses?.startsWith("actions/checkout@") && step.with?.["persist-credentials"] !== false) throw Error("Checkout must not retain credentials");
    }
  }
  for (const name of ['web', 'mobile', 'core', 'maintenance']) {
    const job = workflow.jobs[name];
    if (job.needs !== 'changes' || job.if !== `needs.changes.outputs.${name} == 'true'`) throw Error(`Unexpected validation scope: ${name}`);
  }
  const changes = workflow.jobs.changes;
  if (changes.if || changes.needs) throw Error('Scope detection must always execute');
  const scopeStep = changes.steps.find(step => step.id === 'scope');
  if (!scopeStep || scopeStep.run !== 'node scripts/ci-scope.mjs' || scopeStep.if) throw Error('Scope detection must run the reviewed classifier');
  for (const name of ['web', 'mobile', 'core', 'maintenance']) {
    if (changes.outputs?.[name] !== `\${{ steps.scope.outputs.${name} }}`) throw Error(`Invalid scope output: ${name}`);
  }
  const commands = {
    web: ['npm ci', 'npm run typecheck', 'npm run lint', 'npm run build'],
    mobile: ['npm ci', 'npm run typecheck --workspace @arc-track/mobile', 'node --experimental-strip-types --test tests/scoring-replot.test.mjs'],
    core: ['npm ci', 'npm run typecheck --workspace @arc-track/core', 'npm test --workspace @arc-track/core'],
    maintenance: ['npm ci', 'npm run check:maintenance'],
  };
  for (const [name, required] of Object.entries(commands)) {
    for (const command of required) {
      const steps = workflow.jobs[name].steps.filter(step => step.run === command);
      if (steps.length !== 1 || steps[0].if) throw Error(`Required validation command missing or conditional: ${name} / ${command}`);
    }
  }
  for (const [name, suffix] of [['web', ''], ['mobile', ' --workspace @arc-track/mobile']]) {
    for (const [command, condition] of [
      [`npm run test:essential${suffix}`, "github.event_name != 'workflow_dispatch' || !inputs.full_regression"],
      [`npm test${suffix}`, "github.event_name == 'workflow_dispatch' && inputs.full_regression"],
    ]) {
      const steps = workflow.jobs[name].steps.filter(step => step.run === command);
      if (steps.length !== 1 || steps[0].if !== condition) throw Error(`Regression suite routing changed: ${name}`);
    }
  }
  const gate = workflow.jobs['release-gate'];
  if (gate.name !== 'release-gate' || gate.if !== 'always()' || JSON.stringify([...(gate.needs ?? [])].sort()) !== JSON.stringify(requiredJobs.filter(name => name !== 'release-gate').sort())) throw Error('release-gate must always wait for all validation jobs');
  const verdict = gate.steps.filter(step => step.run === 'node scripts/release-gate.mjs');
  if (verdict.length !== 1 || verdict[0].if || verdict[0].env?.VALIDATION_NEEDS !== '${{ toJSON(needs) }}') throw Error('release-gate must verify the complete results without conditions');
  if (Object.entries(workflow.jobs).some(([name, job]) => name !== 'release-gate' && job.name === 'release-gate')) throw Error('Duplicate release-gate check name');
  const web = workflow.jobs.web;
  const build = web.steps.filter(step => step.run === 'npm run build');
  if (build.length !== 1 || build[0].if || build[0]['continue-on-error'] || web['continue-on-error']) throw Error('Web production build must be required exactly once');
  const performance = web.steps.find(step => step.run === 'npm run test:performance');
  if (!performance || performance['continue-on-error'] !== true) throw Error('Initial performance measurement must be report-only');
  const artifact = web.steps.find(step => step.uses?.startsWith('actions/upload-artifact@'));
  if (!artifact || artifact.if !== 'always()' || artifact.with?.path !== '.verification/performance/' || artifact.with?.['retention-days'] !== 14) throw Error('Retain only scoped public performance artifacts for 14 days');
  return workflow;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  validateWorkflow(await readFile(new URL("../.github/workflows/validate.yml", import.meta.url), "utf8"));
  console.log("Workflow YAML and local validation-only security contract passed; hosted execution is not verified.");
}
