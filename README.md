# Tindahan ni Lola

Simple offline POS / utang ledger for a small sari-sari/tindahan workflow.

## What It Does

- Opens to the utang ledger first.
- Stores products with names and prices only.
- Adds utang by customer, product, quantity, and automatic total.
- Quick-adds a new product when Lola types an item that is not yet saved.
- Records partial or full payments with date/time logs.
- Hides fully paid customers from the active utang list and keeps them in history.
- Prints/downloads per-customer PDF utang receipts.
- Lets the store name be changed in Settings.
- Supports Bisaya/Cebuano, Taglish, Bisaya-English, and English.
- Protects product/settings/import actions with a 4-digit PIN.
- Exports/imports manual JSON backups.
- Shows developer credit: Alejandro M. Martinez Jr. ( Arar ).

Default PIN: `1234`

## Tech

- React + TypeScript + Vite
- Capacitor 8 Android APK shell
- `@capacitor-community/sqlite` for native Android SQLite storage
- Browser preview uses localStorage so it can run on desktop without an emulator

Android target:

- `minSdkVersion = 24` / Android 7+
- App package: `com.tindahan.lola`

## Commands

```bash
npm run dev
npm test
npm run lint
npm run build
npx cap sync android
```

Build debug APK on this machine with Android Studio's bundled JDK:

```powershell
$env:JAVA_HOME='C:\Program Files\Android\Android Studio\jbr'
$env:Path="$env:JAVA_HOME\bin;$env:Path"
cd android
.\gradlew.bat assembleDebug
```

Debug APK output:

```text
android/app/build/outputs/apk/debug/app-debug.apk
```
