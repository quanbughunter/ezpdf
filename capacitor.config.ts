import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Android app. `npm run build:android` builds the web app in android mode and
 * copies it into android/; open android/ in Android Studio (or run
 * `./gradlew assembleDebug` there) to get the APK.
 */
const config: CapacitorConfig = {
  appId: 'app.ezpdf',
  appName: 'ezPDF',
  webDir: 'dist',
  android: {
    // Documents never leave the device; nothing is loaded over plain HTTP.
    allowMixedContent: false,
    // WebView debugging (chrome://inspect) follows Capacitor's default:
    // on in debug APKs, for testing on a phone; off in release builds.
  },
  plugins: {
    SystemBars: {
      // The page has no viewport-fit=cover, so Capacitor keeps it clear of
      // the status bar and the gesture bar (it pads the window natively).
      // Dark icons, because ezPDF's bars are light.
      style: 'LIGHT',
    },
  },
};

export default config;
