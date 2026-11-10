/**
 * The version of ezPDF that is running (web app, Windows, Android), shown at
 * the foot of the start screen so a new version is seen at a glance, and in
 * the desktop window's title. It is the version in package.json, the one the
 * release carries (ezPDF-X.Y.Z-android.apk, ezPDF-X.Y.Z-windows-setup.exe).
 */

/** "0.8.8" (outside a Vite build, e.g. a test run by tsx: "dev") */
export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';
