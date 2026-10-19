const { withAppBuildGradle } = require("expo/config-plugins");

// SDK 57's template selects proguard-android.txt, which disables optimisation.
// Apply this during Prebuild so EAS-generated Android projects use it too.
module.exports = function withOptimizedAndroidRelease(config) {
  return withAppBuildGradle(config, (config) => {
    const original = /getDefaultProguardFile\((["'])proguard-android\.txt\1\)/g;
    const optimized = /getDefaultProguardFile\((["'])proguard-android-optimize\.txt\1\)/;
    if (config.modResults.language !== "groovy") {
      throw new Error("Review Android release optimisation: expected Expo's Groovy build.gradle.");
    }
    config.modResults.contents = config.modResults.contents.replace(
      original,
      'getDefaultProguardFile("proguard-android-optimize.txt")',
    );
    if (!optimized.test(config.modResults.contents)) {
      throw new Error("Review Android release optimisation: Expo's default ProGuard configuration changed.");
    }
    return config;
  });
};
