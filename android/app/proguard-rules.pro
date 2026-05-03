# ---------- General debug-friendly attrs ----------
# Keep annotations/signatures (helps Kotlin/JSON/reflection) and line numbers for better stacktraces.
-keepattributes *Annotation*,Signature,InnerClasses,EnclosingMethod,SourceFile,LineNumberTable

# If you prefer not to expose original file names, you can rename them:
# -renamesourcefileattribute SourceFile

# ---------- Capacitor / Plugins ----------
# Capacitor core + plugin discovery uses reflection; don't strip classes/members.
-keep class com.getcapacitor.** { *; }
-keep class com.capacitorjs.plugins.** { *; }

# (Optional) If you have any custom plugins/package names, keep them too:
# -keep class com.yourorg.plugins.** { *; }

# ---------- Google Play Billing ----------
-keep class com.android.billingclient.** { *; }
-dontwarn com.android.billingclient.**

# ---------- RevenueCat Purchases SDK ----------
-keep class com.revenuecat.purchases.** { *; }
-dontwarn com.revenuecat.**

# ---------- Sentry (if you use it on Android) ----------
# Safe to keep; helps symbolication and integrations.
-keep class io.sentry.** { *; }
-dontwarn io.sentry.**
# Some SDKs reference these annotations; avoid harmless warnings.
-dontwarn org.jetbrains.annotations.**

# ---------- WebView JavaScript interface (only if you use addJavascriptInterface) ----------
# Replace with your fully-qualified bridge class if applicable:
# -keepclassmembers class com.yourorg.web.JsBridge {
#     public *;
# }

# ---------- OkHttp/Okio (usually not needed, but silences rare warnings) ----------
# -dontwarn okhttp3.**
# -dontwarn okio.**

# ---------- WorkManager / AndroidX (only if you hit shrink issues there) ----------
# -keep class androidx.work.** { *; }
# -dontwarn androidx.work.**
