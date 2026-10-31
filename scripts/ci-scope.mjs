import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export function ciScope(paths) {
  const result = { web: false, mobile: false, core: false, maintenance: true };
  for (const path of paths) {
    if (/^(?:package(?:-lock)?\.json|[^/]+\.(?:mjs|ts|json)|\.github\/|scripts\/)/.test(path)) {
      for (const key of Object.keys(result)) result[key] = true;
    } else if (path.startsWith("packages/core/")) {
      result.core = result.web = result.mobile = result.maintenance = true;
    } else if (path.startsWith("apps/mobile/")) result.mobile = result.maintenance = true;
    else if (/^tests\/(?:maintenance|counter-parity)\.test\.mjs$/.test(path)) result.maintenance = true;
    else if (path.startsWith("infra/")) result.web = result.maintenance = true;
    else if (path.startsWith("src/") || path.startsWith("tests/") || path.startsWith("public/")) result.web = result.maintenance = true;
    else if (path.startsWith("supabase/")) result.maintenance = result.web = true;
    else if (!/^(?:docs\/.*|[^/]+)\.(?:md|txt)$/i.test(path)) {
      // Unknown tooling/configuration must never bypass platform validation.
      for (const key of Object.keys(result)) result[key] = true;
    }
  }
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { BASE_SHA, HEAD_SHA, FORCE_ALL, GITHUB_OUTPUT } = process.env;
  let scope;
  if (FORCE_ALL === "true" || !BASE_SHA || /^0+$/.test(BASE_SHA)) scope = ciScope(["package.json"]);
  else {
    if (![BASE_SHA, HEAD_SHA].every(value => /^[a-f0-9]{40,64}$/.test(value ?? ""))) throw Error("Invalid comparison revision");
    // Argument array and NUL-separated paths avoid shell and filename injection.
    const paths = execFileSync("git", ["diff", "--name-only", "--no-renames", "-z", BASE_SHA, HEAD_SHA, "--"], { encoding: "utf8" }).split("\0").filter(Boolean);
    scope = ciScope(paths);
  }
  const output = Object.entries(scope).map(([key, value]) => `${key}=${value}`).join("\n") + "\n";
  if (GITHUB_OUTPUT) appendFileSync(GITHUB_OUTPUT, output);
  process.stdout.write(output);
}
