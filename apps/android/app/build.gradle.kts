import java.util.Properties

plugins {
    id("com.android.application")
}

// The version follows DinePOS for Windows (apps/desktop/package.json): one commit, one version everywhere.
val dineposVersion: String = Regex("\"version\"\\s*:\\s*\"([0-9]+\\.[0-9]+\\.[0-9]+)\"")
    .find(rootProject.file("../desktop/package.json").readText())!!.groupValues[1]
val (vMajor, vMinor, vPatch) = dineposVersion.split(".").map { it.toInt() }

// Signed with DinePOS's Android key (the Captain app's: apps/captain-android/keystore, never in git), so there is one
// key to keep safe. Android installs an update only when it is signed with the same key.
val signing = Properties().apply {
    val f = rootProject.file("../captain-android/keystore.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}

android {
    namespace = "com.dinepos.pos"
    compileSdk = 37

    defaultConfig {
        applicationId = "com.dinepos.pos"
        minSdk = 24
        // 36, not 37: Android 17's local-network permission would need a prompt for the captain phones on the Wi-Fi
        targetSdk = 36
        versionCode = vMajor * 10000 + vMinor * 100 + vPatch
        versionName = dineposVersion
    }

    signingConfigs {
        if (signing.getProperty("storeFile") != null) {
            create("release") {
                storeFile = rootProject.file("../captain-android/" + signing.getProperty("storeFile"))
                storePassword = signing.getProperty("storePassword")
                keyAlias = signing.getProperty("keyAlias")
                keyPassword = signing.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.findByName("release")
        }
    }

    // One APK per processor type: Node and its libraries are large, a device needs only its own.
    splits {
        abi {
            isEnable = true
            reset()
            include("arm64-v8a", "armeabi-v7a", "x86_64")
            isUniversalApk = false
        }
    }

    packaging {
        // Node runs as a program: its files must be unpacked on the device (in the app's native library folder).
        jniLibs { useLegacyPackaging = true }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

base.archivesName.set("DinePOS-$dineposVersion")
