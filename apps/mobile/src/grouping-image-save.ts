import { PermissionsAndroid, Platform } from "react-native";

/** Save only app-generated PNGs. Never request permission to read the user's photos. */
export async function saveGroupingImage(fileUri: string): Promise<void> {
  if (!fileUri.startsWith("file://") || !fileUri.endsWith(".png")) throw new Error("The PNG image could not be prepared. Please try again.");
  try {
    const files = await import("expo-file-system/legacy");
    const info = await files.getInfoAsync(fileUri);
    if (!info.exists || info.isDirectory || info.size === 0) {
      throw new Error("The PNG file is missing or empty. Please export the image again.");
    }
    if (Platform.OS === "android") {
      if (Number(Platform.Version) < 30) {
        const permission = PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE;
        if (!await PermissionsAndroid.check(permission)) {
          const status = await PermissionsAndroid.request(permission);
          if (status !== PermissionsAndroid.RESULTS.GRANTED) throw new Error(status === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN
            ? "Allow storage access in Android Settings to save images. You can still use Share Image."
            : "Storage access was not allowed. You can still use Share Image.");
        }
      }
      // SDK 57's modern Android implementation publishes app-owned MediaStore assets.
      // This import stays lazy so Share Image works in binaries without the new module.
      const { Asset } = await import("expo-media-library");
      await Asset.create(fileUri);
    } else if (Platform.OS === "ios") {
      // SDK 57 compatibility: this add-only method avoids fetching/reading the created
      // PHAsset, which the new Asset.create path does after creation on iOS.
      const library = await import("expo-media-library/legacy");
      let permission = await library.getPermissionsAsync(true, []);
      if (!permission.granted && permission.canAskAgain) permission = await library.requestPermissionsAsync(true, []);
      if (!permission.granted) throw new Error(permission.canAskAgain
        ? "Photo saving was not allowed. You can still use Share Image."
        : "Allow Add Photos access in iOS Settings to save images. You can still use Share Image.");
      await library.saveToLibraryAsync(fileUri);
    } else {
      throw new Error("Save to Device is available in the Android and iOS apps. You can still use Share Image.");
    }
  } catch (issue) {
    const message = issue instanceof Error ? issue.message : "";
    if (/Cannot find native module|native module.*(unavailable|not found)/i.test(message)) throw new Error("Gallery saving needs the updated Arc Track native app build. You can still use Share Image.");
    if (/You can still use Share Image/.test(message)) throw issue;
    if (message === "The PNG file is missing or empty. Please export the image again.") throw issue;
    throw new Error("The image could not be saved to Photos or Gallery. Check available storage and photo-saving permission, then try again.");
  }
}
