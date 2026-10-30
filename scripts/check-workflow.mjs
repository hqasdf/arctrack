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
  const actions = new Set(["actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803", "actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38", "actions/upload-artifact@bbbca2ddaa5d8feaa63e36b76fdaad77386f024f"]);
  if (/secrets\s*[.[]|\b(?:vercel|wrangler|eas|supabase)\s+(?:deploy|build|update|db|migration)|npm\s+publish/i.test(source)) throw Error("Validation CI must not use secrets or release commands");
  for (const name of new Set(["changes", "web", "mobile", "core", "maintenance", ...Object.keys(workflow.jobs ?? {})])) {
    const job = workflow.jobs?.[name];
    if (!job || !job["timeout-minutes"] || job.permissions) throw Error(`Invalid validation job: ${name}`);
    for (const step of job.steps ?? []) {
      if (step.uses && !actions.has(step.uses)) throw Error(`Unreviewed action: ${step.uses}`);
      if (step.uses?.startsWith("actions/checkout@") && step.with?.["persist-credentials"] !== false) throw Error("Checkout must not retain credentials");
    }
  }
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
