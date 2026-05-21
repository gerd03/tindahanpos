# Future APK Updates Guide

This app supports an in-app update prompt through a public `version.json` file.

## How It Works

1. User opens the installed APK.
2. The app checks:
   `https://tindahanpos.vercel.app/version.json`
3. If the online `versionCode` is higher than the installed app version, the app shows:
   - `Update available`
   - `Update Now`
   - `Later`
4. `Update Now` opens the APK download link.
5. Android asks the user to confirm the update.
6. The app updates without uninstalling, as long as the package name and signing key stay the same.

## Critical Rules

- Keep package name the same forever:
  `com.simplepos.sukitrack`
- Use the same signing key for every release APK.
- Increase `versionCode` every update.
- Do not ask users to uninstall, or local app data may be lost.

## Files To Update Every Release

### 1. Android Version

Edit:
`android/app/build.gradle`

Example:

```gradle
versionCode 2
versionName "1.0.1"
```

Rules:
- `versionCode` must always go up: `1`, `2`, `3`, etc.
- `versionName` is the display version: `"1.0.1"`, `"1.0.2"`, etc.

### 2. App Current Version

Edit:
`src/lib/update.ts`

Example:

```ts
export const CURRENT_APP_VERSION = '1.0.1';
export const CURRENT_APP_VERSION_CODE = 2;
```

These values should match `android/app/build.gradle`.

### 3. Online Update Manifest

Edit:
`public/version.json`

Example:

```json
{
  "version": "1.0.1",
  "versionCode": 2,
  "apkUrl": "https://github.com/gerd03/tindahanpos/releases/download/v1.0.1/suki-track-1.0.1.apk",
  "notes": "Bug fixes and UI improvements.",
  "required": false
}
```

Rules:
- `versionCode` must be higher than the installed APK version.
- `apkUrl` must be a direct public link to the new APK.
- Set `required` to `true` only if users should not skip the update.

## Release Workflow

1. Make code changes.
2. Run tests/build:

```bash
npm run build
npm run test
```

3. Update these version files:
   - `android/app/build.gradle`
   - `src/lib/update.ts`
   - `public/version.json`
4. Build the new APK in Android Studio or Gradle.
5. Upload the APK to GitHub Releases.
6. Make sure `public/version.json` points to that uploaded APK.
7. Deploy the updated `version.json` to Vercel.
8. Commit and push changes:

```bash
git add .
git commit -m "Release v1.0.1"
git push
```

## GitHub Releases

Recommended release tag format:

```text
v1.0.1
```

Recommended APK filename:

```text
suki-track-1.0.1.apk
```

The APK URL should look like:

```text
https://github.com/gerd03/tindahanpos/releases/download/v1.0.1/suki-track-1.0.1.apk
```

## Vercel Setup

Deploy the project or a simple static update site to Vercel.

The app currently checks:

```text
https://tindahanpos.vercel.app/version.json
```

If your Vercel URL is different, update this file:

`src/lib/update.ts`

```ts
export const UPDATE_MANIFEST_URL = 'https://your-vercel-url.vercel.app/version.json';
```

## Testing The Update Prompt

To test:

1. Install APK with:
   - `versionCode 1`
2. Put this online in `version.json`:
   - `versionCode 2`
3. Open the installed app.
4. The update prompt should appear.

If it does not appear:
- Check internet connection.
- Check that `version.json` is public.
- Check that `versionCode` online is higher.
- Check that `UPDATE_MANIFEST_URL` is correct.

## Important Signing Reminder

Keep your release keystore safe.

If you lose the signing key, future APKs cannot update the installed APK. Users would need to uninstall and reinstall, which can remove local data.
