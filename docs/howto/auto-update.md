# Automatic Updates

This app now supports in-app update checks and installer downloads through Tauri's official updater plugin.

## What users see

- The app does one silent update check on launch in packaged builds.
- If a newer release is found, the UI shows an update banner and a manual install button in the `About` view.
- Clicking `Download and install` downloads the signed updater bundle, installs it, and relaunches the app.

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
- upload `latest.json` to the GitHub Release.

The app checks this URL at runtime:

`https://github.com/iohao/token-ledger/releases/latest/download/latest.json`
