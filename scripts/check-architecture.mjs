import { readdir, readFile } from "node:fs/promises";
import { posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const CORE = "packages/core/src/";
const WEB = "src/";
const MOBILE = "apps/mobile/";

// Parse syntax rather than matching comments, strings or type-only edges as code.
export function moduleReferences(source, file = "module.ts") {
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const references = [];
  function visit(node) {
    let value, runtime = true;
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      value = node.moduleSpecifier;
      const clause = node.importClause;
      const bindings = clause?.namedBindings;
      runtime = !node.isTypeOnly && !clause?.isTypeOnly;
      if (clause && !clause.name && bindings && ts.isNamedImports(bindings)) {
        runtime &&= bindings.elements.some(element => !element.isTypeOnly);
      }
      if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)) {
        runtime &&= node.exportClause.elements.some(element => !element.isTypeOnly);
      }
    } else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
      (ts.isIdentifier(node.expression) && node.expression.text === "require"))) value = node.arguments[0];
    if (value && ts.isStringLiteralLike(value)) references.push({ specifier: value.text, runtime });
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return references;
}

export function validateArchitecture(files, coreExports) {
  const errors = [];
  const coreGraph = new Map();
  function targetOf(file, specifier) {
    let base;
    if (specifier.startsWith(".")) base = posix.normalize(posix.join(posix.dirname(file), specifier));
    else if (specifier.startsWith("@/")) base = (file.startsWith(MOBILE) ? MOBILE : WEB) + specifier.slice(2);
    else if (specifier === "@arc-track/core" || specifier.startsWith("@arc-track/core/")) {
      const key = specifier === "@arc-track/core" ? "." : "./" + specifier.slice("@arc-track/core/".length);
      const exported = coreExports[key];
      if (!exported) { errors.push(`${file}: undeclared core export ${specifier}`); return; }
      base = "packages/core/" + exported.replace(/^\.\//, "");
    } else return;
    return [base, base + ".ts", base + ".tsx", base + ".mjs", base + "/index.ts", base + "/index.tsx"].find(candidate => files.has(candidate)) ?? base;
  }
  for (const [file, source] of files) {
    const references = moduleReferences(source, file);
    const edges = [];
    for (const { specifier, runtime } of references) {
      const target = targetOf(file, specifier);
      if (file.startsWith(CORE)) {
        if (!target || !target.startsWith(CORE)) errors.push(`${file}: core must not depend on ${specifier}`);
        else if (runtime) edges.push(target);
      }
      if (target && ((file.startsWith(WEB) && target.startsWith(MOBILE)) ||
        (file.startsWith(MOBILE) && target.startsWith(WEB)))) errors.push(`${file}: platform-to-platform import ${specifier}; use core or an API contract`);
      if (file.startsWith("src/features/") && target?.startsWith("src/app/")) errors.push(`${file}: feature imports route implementation ${specifier}`);
    }
    if (file.startsWith(CORE)) coreGraph.set(file, edges);
  }
  const active = new Set(), done = new Set();
  function visit(file, path) {
    if (active.has(file)) { errors.push(`Core runtime cycle: ${[...path, file].join(" -> ")}`); return; }
    if (done.has(file)) return;
    active.add(file);
    for (const dependency of coreGraph.get(file) ?? []) visit(dependency, [...path, file]);
    active.delete(file); done.add(file);
  }
  for (const file of coreGraph.keys()) visit(file, []);
  return [...new Set(errors)];
}

export async function checkArchitecture(root = fileURLToPath(new URL("../", import.meta.url))) {
  const files = new Map();
  async function collect(relative) {
    for (const entry of await readdir(resolve(root, relative), { withFileTypes: true })) {
      const file = relative + "/" + entry.name;
      if (entry.isDirectory()) await collect(file);
      else if (/\.(?:ts|tsx|mjs)$/.test(entry.name) && !entry.name.endsWith(".d.ts")) files.set(file, await readFile(resolve(root, file), "utf8"));
    }
  }
  for (const directory of ["src", "apps/mobile/app", "apps/mobile/src", "packages/core/src"]) await collect(directory);
  const { exports: coreExports } = JSON.parse(await readFile(resolve(root, "packages/core/package.json"), "utf8"));
  const errors = validateArchitecture(files, coreExports);
  if (errors.length) throw Error(errors.join("\n"));
  return { files: files.size };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await checkArchitecture();
  console.log(`Architecture boundaries passed (${result.files} source files); core has no runtime import cycles.`);
}
