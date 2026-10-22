const { withAndroidManifest, AndroidConfig } = require("expo/config-plugins");
// expo-media-library uses the legacy filesystem only below Android 11. Cap the
// save-only storage permission there; do not grant modern media read access.
module.exports = function withSaveOnlyMedia(config) {
  return withAndroidManifest(config, (result) => {
    const manifest = result.modResults.manifest;
    manifest.$["xmlns:tools"] = "http://schemas.android.com/tools";
    const entries = manifest["uses-permission"] ??= [];
    let permission = entries.find(item => item.$["android:name"] === "android.permission.WRITE_EXTERNAL_STORAGE");
    if (!permission) entries.push(permission = { $: { "android:name": "android.permission.WRITE_EXTERNAL_STORAGE" } });
    permission.$["android:maxSdkVersion"] = "29";
    permission.$["tools:replace"] = "android:maxSdkVersion";
    // Required by the SDK's Android 10 legacy creation path. Android 11+ ignores
    // this flag and Asset.create uses scoped MediaStore instead.
    AndroidConfig.Manifest.getMainApplicationOrThrow(result.modResults).$["android:requestLegacyExternalStorage"] = "true";
    return result;
  });
};
