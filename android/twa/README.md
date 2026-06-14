# Loveca Android TWA Packaging

This directory tracks the Android packaging route for Loveca. The first supported route is Trusted Web Activity (TWA), because the app is currently deployed as a same-origin Web app and depends on `/api`, `/images`, and httpOnly refresh cookies.

## Current Status

- PWA manifest and install icons are generated from `assets/icon.jpg`.
- `pnpm android:pwa:build` builds the Web/PWA output in `client/dist`.
- `pnpm android:assetlinks` generates the Digital Asset Links file once the release signing fingerprint is known.
- `android/twa/loveca/` contains the generated Bubblewrap TWA Android project for `https://loveca.lovelivefun.xyz`.
- Local test APK/AAB outputs can be generated with Docker Bubblewrap. The APK/AAB files and local keystore are ignored by git.
- Capacitor local-bundle packaging is intentionally not started until CORS, cookie refresh, and image URL strategy are redesigned.

## Candidate Release Values

These values are candidates from the draft guide and must be confirmed before the first public release. The Android package ID is hard to change after distribution.

```text
Web origin: https://loveca.lovelivefun.xyz
Android package: xyz.lovelivefun.loveca
App name: Loveca
Launcher name: Loveca
Start URL: /
Display mode: standalone
```

## Local Prerequisite Check

```bash
pnpm android:twa:doctor
```

For release packaging, the machine should have JDK 17+, Android SDK command line tools, `sdkmanager`, and `adb`. A standalone `gradle` command is optional when the generated Android project includes a Gradle wrapper.

## Build PWA Assets

```bash
pnpm android:pwa:build
```

The build output should include:

- `client/dist/manifest.webmanifest`
- `client/dist/pwa/icon-192.png`
- `client/dist/pwa/icon-512.png`
- `client/dist/pwa/icon-maskable-192.png`
- `client/dist/pwa/icon-maskable-512.png`
- `client/dist/sw.js`
- `client/dist/version.json`

## Build TWA With Docker Bubblewrap

The generated project is at `android/twa/loveca/`. From the repository root:

```bash
BUBBLEWRAP_KEYSTORE_PASSWORD=<keystore-password> \
BUBBLEWRAP_KEY_PASSWORD=<key-password> \
pnpm android:twa:build:docker
```

When Gradle or Android SDK downloads are slow, pass the local proxy from the host. If the proxy URL uses `127.0.0.1` or `localhost`, the script automatically runs Docker with host networking so the container can reach the host proxy.

```bash
http_proxy=http://127.0.0.1:7890 \
https_proxy=http://127.0.0.1:7890 \
BUBBLEWRAP_KEYSTORE_PASSWORD=<keystore-password> \
BUBBLEWRAP_KEY_PASSWORD=<key-password> \
pnpm android:twa:build:docker
```

Current local outputs:

- `android/twa/loveca/app-release-signed.apk`
- `android/twa/loveca/app-release-bundle.aab`

The script automatically accepts Android SDK licenses and applies pending `twa-manifest.json` changes to the generated project before building. It uses `--skipPwaValidation` by default while the live production site is still serving the old manifest. After deploying the updated PWA manifest and icons to `https://loveca.lovelivefun.xyz/`, run with `ANDROID_TWA_SKIP_PWA_VALIDATION=false`.

Until the new PWA icons are deployed online, `twa-manifest.json` keeps `iconUrl` and `maskableIconUrl` on the existing `https://loveca.lovelivefun.xyz/icon.jpg`. Switch them to `/pwa/icon-512.png` and `/pwa/icon-maskable-512.png` only after those files are live.

## Generate Digital Asset Links

After generating the release signing key, get its SHA-256 certificate fingerprint and run:

```bash
ANDROID_PACKAGE_NAME=xyz.lovelivefun.loveca \
ANDROID_SHA256_FINGERPRINT=AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99 \
pnpm android:assetlinks
```

This writes `assets/.well-known/assetlinks.json`, which Vite publishes at `/.well-known/assetlinks.json` because `assets/` is the configured public directory.

The current local test APK uses this SHA-256 certificate fingerprint:

```text
E9:4F:11:F9:C4:FD:A3:52:83:4A:E6:A0:88:05:4C:51:9B:AB:29:4C:E7:5F:D3:D7:41:8F:51:B7:11:35:EC:77
```

Regenerate `assetlinks.json` when replacing the local test key with the final release or upload signing key.

## Generate TWA Project

Once the production site serves the updated PWA manifest over HTTPS and the local Android toolchain is ready:

```bash
pnpm dlx @bubblewrap/cli init --manifest=https://loveca.lovelivefun.xyz/manifest.webmanifest
pnpm dlx @bubblewrap/cli build
```

Run these commands from the directory where the generated native project should live. Keep generated keystores out of git, and commit only the native project files after package ID, versioning, signing, and asset links are confirmed.
