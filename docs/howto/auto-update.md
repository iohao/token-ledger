# Automatic Updates

This app now supports in-app update checks and installer downloads through Tauri's official updater plugin.

## What users see

- The app does one silent update check on launch in packaged builds.
- If a newer release is found, the UI shows an update banner and a manual install button in the `About` view.
- Clicking `Download and install` downloads the signed updater bundle, installs it, and relaunches the app.

## macOS caveat for local distribution

The current release pipeline signs Tauri updater bundles, but the macOS app itself is not yet signed with an Apple Developer ID certificate or notarized by Apple.

That means:

- update checks can still work,
- the app can still download a newer release,
- but macOS may block the downloaded replacement app on first launch.

If you are testing a macOS build outside a fully signed and notarized distribution flow, prefer the GitHub Release install package instead of a manually copied `.app` bundle. If macOS blocks the updated app, remove the quarantine flag from the installed app bundle:

```bash
xattr -dr com.apple.quarantine "/path/to/TokenLedger.app"
```

## Release prerequisites

Generate a Tauri updater keypair once and keep the private key secret:

```bash
npm run desktop signer generate -- --ci -p "" -w local/tauri-updater.key
```

The repository already ignores `local/`, so the generated private key stays local by default.

## GitHub Actions secrets

Set these repository secrets before pushing a release tag:

- `TAURI_SIGNING_PRIVATE_KEY`: the full private key content from `local/tauri-updater.key`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: optional; leave empty if the key has no password

The public key is checked into [src-tauri/tauri.conf.json](../../src-tauri/tauri.conf.json).

## Publishing a release

1. Update the app version in `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`.
2. Commit the version bump.
3. Push a tag such as `v0.2.0`.

The release workflow will:

- build the signed updater bundles,
- upload release assets,
- generate `latest.json`,
- upload `latest.json` to the GitHub Release,
- publish `latest.json` to the `release-manifest` branch to serve via CDN,
- purge the jsDelivr CDN cache to make it effective immediately.


The app checks these URLs in order at runtime to verify and fetch updates:

1. `https://cdn.jsdelivr.net/gh/iohao/token-ledger@release-manifest/latest.json` (Primary endpoint via jsDelivr CDN)
2. `https://github.com/iohao/token-ledger/releases/latest/download/latest.json` (Official GitHub Release endpoint)
3. `https://gh-proxy.com/https://github.com/iohao/token-ledger/releases/latest/download/latest.json` (GitHub proxy endpoint fallback)

