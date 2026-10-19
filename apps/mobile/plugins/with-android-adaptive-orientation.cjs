const { AndroidConfig, withAndroidManifest } = require("expo/config-plugins");

// Keep Expo's portrait policy for iOS, but let Android manage window orientation.
module.exports = function withAndroidAdaptiveOrientation(config) {
  return withAndroidManifest(config, (config) => {
    const activity = AndroidConfig.Manifest.getMainActivityOrThrow(config.modResults);
    delete activity.$["android:screenOrientation"];
    return config;
  });
};
