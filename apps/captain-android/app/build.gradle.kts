import java.util.Properties

plugins {
    id("com.android.application")
}

// Signing key for the release APK: keystore.properties (made by `npm run apk` the first time, not in git).
val signing = Properties().apply {
    val f = rootProject.file("keystore.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}

android {
    namespace = "com.dinepos.captain"
    compileSdk = 37

    defaultConfig {
        applicationId = "com.dinepos.captain"
        minSdk = 26
        // 36, not 37: Android 17's local-network permission would need a runtime prompt for the shop LAN
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"
    }

    signingConfigs {
        if (signing.getProperty("storeFile") != null) {
            create("release") {
                storeFile = rootProject.file(signing.getProperty("storeFile"))
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

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    testOptions {
        unitTests.isReturnDefaultValues = false
    }
}

dependencies {
    // org.json is part of Android, but the unit tests run on a plain JVM
    testImplementation("org.json:json:20250517")
    testImplementation("junit:junit:4.13.2")
}
