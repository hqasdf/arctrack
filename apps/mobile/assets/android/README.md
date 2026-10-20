# Android launcher artwork

These PNGs reuse the existing Arc Track artwork from `src/app/icon.svg` at the repository root. The logo paths and original colours are unchanged.

- `icon.png`: 1024 × 1024 raster export of the original SVG for legacy launchers.
- `adaptive-foreground.png`: the same mark without the background rectangle, on a transparent 1024 × 1024 canvas. Expanding the original SVG viewBox from `0 0 64 64` to `-16 -16 96 96` supplies adaptive-icon padding; all visible foreground pixels fit inside Android's central 66/108 safe circle.
- Adaptive background: the original `#563d30` brown.
- Themed/monochrome icon: reuses the foreground's single-colour alpha silhouette; Android supplies the theme colour. No duplicate monochrome asset is necessary.

Only `expo.android.icon` and `expo.android.adaptiveIcon` reference these assets. The website and iOS icon configuration are unaffected.

Expo's existing Android icon generator creates density-specific square, round, foreground and monochrome resources during Prebuild/EAS builds. Keep the PNG files with `app.json`; changing generated files under the ignored `android/` directory alone would not persist.
