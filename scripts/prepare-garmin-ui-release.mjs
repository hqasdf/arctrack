/** Read-only Git export plus an explicit UI overlay. Never commits or deploys. */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

if (process.argv.length !== 2) throw new Error("No arguments accepted; review the pinned production baseline first.");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const baseline = "734afe7b5e952dcf0e3699c74f30b0599afa6704";
const files = [
  "src/app/(platform)/health/page.tsx", "src/app/(platform)/profile/page.tsx",
  "src/features/garmin/components/garmin-connection-card.tsx",
  "src/features/garmin/components/garmin-connection.module.css",
  "src/features/garmin/http.server.ts", "src/features/health/components/health-cards.tsx",
  "src/features/health/components/health-dashboard.tsx", "public/garmin-connect.png",
  "tests/garmin.test.mjs", "tests/health.test.mjs", "docs/garmin-connection-ui.md",
];
const git = args => execFileSync("git", args, { cwd: root, windowsHide: true });
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
if (git(["rev-parse", "HEAD"]).toString().trim() !== baseline) throw new Error("HEAD differs from the reviewed production baseline; stop and reverify.");
for (const file of files) await access(join(root, file));
const verification = join(root, ".verification");
git(["check-ignore", "--quiet", ".verification/"]);
await mkdir(verification, { recursive: true });
const owned = await mkdtemp(join(verification, "garmin-ui-release-"));
const source = join(owned, "source"), archive = join(owned, "baseline.tar");
await mkdir(source);
git(["archive", "--format=tar", `--output=${archive}`, baseline]);
execFileSync("tar", ["-xf", archive, "-C", source], { cwd: root, windowsHide: true });
await rm(archive);
async function tree(folder) {
  const result = {};
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isSymbolicLink()) throw new Error("Unexpected symlink in exported source.");
    if (entry.isDirectory()) Object.assign(result, await tree(path));
    else result[relative(source, path).replaceAll("\\", "/")] = hash(await readFile(path));
  }
  return result;
}
const before = await tree(source);
for (const file of files) {
  await mkdir(dirname(join(source, file)), { recursive: true });
  await copyFile(join(root, file), join(source, file));
}
const after = await tree(source);
const changed = Object.keys(after).filter(file => before[file] !== after[file]).sort();
if (changed.some(file => !files.includes(file))) throw new Error("Unexpected non-UI overlay; do not deploy this export.");
if (Object.keys(after).some(file => /(^|\/)\.env(?!\.example$)|(^|\/)\.vercel\//.test(file))) throw new Error("Private configuration in export.");
const privateRoute = "src/app/api/integrations/garmin/health/push/[secret]/route.ts";
if (after[privateRoute]) throw new Error("Release B private webhook must not be included in Release A.");
const migration = "supabase/migrations/20261023155612_garmin_health_sync.sql";
if (before[migration] !== after[migration]) throw new Error("Release B migration changes leaked into Release A.");
const manifest = { baseline, project: "archery-website", source, activation: "UI only; no environment, migration, scheduler or ingestion changes",
  changed: changed.map(file => ({ file, sha256: after[file] })),
  privateWebhookIncluded: false, migrationUnchangedFromBaseline: true, privateEnvironmentIncluded: false };
await writeFile(join(owned, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(JSON.stringify({ source, manifest: join(owned, "manifest.json"), changedFiles: changed.length, baseline,
  note: "Local source export only. Existing worktree/index preserved. Nothing committed, linked or deployed." }, null, 2));
