const { withAppBuildGradle } = require("expo/config-plugins");

// Material 1.14 guards legacy system-bar calls on Android 15+.
// A normal constraint allows newer upstream versions without forcing AndroidX.
const constraint = `    constraints {
        implementation("com.google.android.material:material:1.14.0") {
            because("Guard legacy Material system-bar APIs on Android 15 and later")
        }
    }`;

module.exports = function withAndroidMaterialComponents(config) {
  return withAppBuildGradle(config, (config) => {
    if (config.modResults.language !== "groovy") {
      throw new Error("Review Material Components configuration: expected Expo's Groovy build.gradle.");
    }
    const contents = config.modResults.contents;
    if (!contents.includes(constraint)) {
      const dependencies = /^dependencies[ \t]*\{[ \t]*\r?$/m;
      if (!dependencies.test(contents)) {
        throw new Error("Review Material Components configuration: Expo's dependencies block changed.");
      }
      config.modResults.contents = contents.replace(dependencies, `$&\n${constraint}`);
    }
    return config;
  });
};
