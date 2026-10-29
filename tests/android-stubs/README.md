Compile-only stand-ins for the parts of Capacitor 8.5.3 and androidx.activity
that `EzFilesPlugin.java` and `MainActivity.java` use. Signatures are copied
from `node_modules/@capacitor/android/capacitor/src/main/java`. They let
`scripts/check_android_java.sh` compile the plugin against the real Android
API (`android.jar`) where no Android SDK or Gradle is available. The APK
itself is built by Gradle with the real libraries.
