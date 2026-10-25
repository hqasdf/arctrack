import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export function validateMigrations(files, baseline) {
  const seen = new Set(), entries = new Map();
  for (const { name, content } of files) {
    const match = /^(\d{14})_([a-z0-9_]+)\.sql$/.exec(name);
    if (!match) throw Error(`Invalid migration filename: ${name}`);
    const [, version] = match;
    const date = new Date(`${version.slice(0,4)}-${version.slice(4,6)}-${version.slice(6,8)}T${version.slice(8,10)}:${version.slice(10,12)}:${version.slice(12,14)}Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().replace(/\D/g, "").slice(0,14) !== version) throw Error(`Invalid UTC migration timestamp: ${name}`);
    if (seen.has(version)) throw Error(`Duplicate migration version: ${version}`);
    if (!content.trim() || /^(?:<<<<<<< |=======$|>>>>>>> )/m.test(content)) throw Error(`Empty or conflicted migration: ${name}`);
    seen.add(version);
    entries.set(name, { version, sha256: createHash("sha256").update(content.replace(/\r\n/g, "\n")).digest("hex") });
  }
  for (const previous of baseline.migrations) {
    if (entries.get(previous.file)?.sha256 !== previous.sha256) throw Error(`Historical migration changed or missing: ${previous.file}`);
  }
  const last = baseline.migrations.map(entry => entry.file.slice(0,14)).sort().at(-1);
  for (const [file, { version }] of entries) {
    if (!baseline.migrations.some(entry => entry.file === file) && last && version <= last) throw Error(`New migration must follow the canonical baseline: ${file}`);
  }
  return { count: files.length, historicalAliases: baseline.historicalAliases.length };
}

export async function checkMigrations() {
  const directory = new URL("../supabase/migrations/", import.meta.url);
  const baseline = JSON.parse(await readFile(new URL("../supabase/migration-baseline.json", import.meta.url), "utf8"));
  const names = (await readdir(directory)).filter(name => name.endsWith(".sql")).sort();
  const files = await Promise.all(names.map(async name => ({ name, content: await readFile(new URL(name, directory), "utf8") })));
  return validateMigrations(files, baseline);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 2) throw Error("This local static checker accepts no database arguments");
  const result = await checkMigrations();
  console.log(`${result.count} canonical migrations valid; ${result.historicalAliases} documented historical aliases retained. No database contacted.`);
}
