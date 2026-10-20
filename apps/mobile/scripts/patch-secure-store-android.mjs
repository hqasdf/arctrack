import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Arc Track-owned patch. Review the native contract again before changing either
// version or checksum. A dependency upgrade must not silently omit this fix.
export const secureStorePatch = Object.freeze({
  version: "57.0.4",
  source: "android/src/main/java/expo/modules/securestore/SecureStoreModule.kt",
  originalSha256: "72c670b538732977ef132759ce810c5719943ce6082195a58ad5a432d4ac1075",
  patchedSha256: "338aca227f471d88a5303db18dc68d899a0c40140b70bb64ec42d718d19d45fb",
});

const before = "      saveEncryptedItem(encryptedItem, prefs, keychainAwareKey, options.requireAuthentication, options.keychainService)";
const after = `      val success = saveEncryptedItem(encryptedItem, prefs, keychainAwareKey, options.requireAuthentication, options.keychainService)
      if (!success) {
        throw WriteException("Could not persist encrypted value to SecureStore", key, options.keychainService)
      }`;
const sha256 = value => createHash("sha256").update(value).digest("hex");

export function patchSecureStoreAndroid(packageDirectory) {
  const installed = JSON.parse(readFileSync(join(packageDirectory, "package.json"), "utf8"));
  if (installed.name !== "expo-secure-store" || installed.version !== secureStorePatch.version) {
    throw Error(`SecureStore Android patch requires expo-secure-store@${secureStorePatch.version}; review the native source before upgrading.`);
  }
  const sourcePath = join(packageDirectory, secureStorePatch.source);
  const source = readFileSync(sourcePath, "utf8").replace(/\r\n/g, "\n");
  const checksum = sha256(source);
  if (checksum === secureStorePatch.patchedSha256) return "already patched";
  if (checksum !== secureStorePatch.originalSha256 || source.split(before).length !== 2) {
    throw Error("SecureStore Android source differs from the reviewed version; patch not applied.");
  }
  const patched = source.replace(before, after);
  if (sha256(patched) !== secureStorePatch.patchedSha256) {
    throw Error("SecureStore Android patch checksum failed; source not written.");
  }
  writeFileSync(sourcePath, patched);
  return "patched";
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // Resolve from the mobile workspace, including when npm hoists its dependency.
  const require = createRequire(new URL("../package.json", import.meta.url));
  const directory = dirname(require.resolve("expo-secure-store/package.json"));
  console.log(`[Arc Track] SecureStore Android ${secureStorePatch.version}: ${patchSecureStoreAndroid(directory)}.`);
}
