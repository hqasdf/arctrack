import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const read = (path) => readFileSync(join(process.cwd(), path), "utf8");

test("web owner and Coach Session readers share newest-first Round presentation", () => {
  const ownerReader = read("src/features/sessions/read.server.ts");
  const coachReader = read("src/features/organizations/coach-read.server.ts");
  assert.match(ownerReader, /newestRoundsFirst\(rounds\)/);
  assert.match(ownerReader, /row\.session_rounds\?\?\[\]\)\.map\(mapRound\)/);
  assert.match(coachReader, /mapSession\(row\)/);
});
