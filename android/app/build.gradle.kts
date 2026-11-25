// Atlas Saúde Sentinela: repassa por SMS os alarmes do app da Abbott (decisão A do Daniel: limites ficam no app da Abbott).
// Assinatura: só no GitHub Actions (SENTINELA_KEYSTORE / SENTINELA_SENHA); nunca no repositório em claro.
plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.atlassolucoes.sentinela"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.atlassolucoes.sentinela"
        minSdk = 26
        targetSdk = 35
        versionCode = (System.getenv("VERSAO_CODIGO") ?: "1").toInt()
        versionName = "0.1." + versionCode
    }

    signingConfigs {
        create("familia") {
            val ks = System.getenv("SENTINELA_KEYSTORE")
            if (ks != null) {
                storeFile = file(ks)
                storePassword = System.getenv("SENTINELA_SENHA")
                keyAlias = "sentinela"
                keyPassword = System.getenv("SENTINELA_SENHA")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            if (System.getenv("SENTINELA_KEYSTORE") != null) signingConfig = signingConfigs.getByName("familia")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.work:work-runtime:2.9.1")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
}
