# Windows installer and updates

## For users

Install `SolSeer-Setup-X.Y.Z.exe` once. The per-user installer creates desktop and Start menu shortcuts; no Node installation or terminal is needed. Existing portable users must install this version once and stop launching their old extracted copy. Settings, Roblox cookie, webhook, and join history remain in the existing `%LOCALAPPDATA%\solseer` directory.

Installed copies check public stable GitHub Releases 10 seconds after startup and every six hours. Settings → Setup also has **Check for updates**. Updates download in the background; a banner offers **Restart to update** or **Later**. Restart requires a native confirmation and stops backend automation before installing. Normal app exit does **not** automatically install a downloaded update. A failed check leaves the current app running.

Development (`npm run dev`, `npm run desktop`) and portable ZIP copies do not check for or install updates. Browser development still works unchanged. Updates are sourced from `SamSKNg/SolSeer` GitHub Releases, never from commits on `main`. Protect this repository and its release permissions; do not rename/transfer it without planning a feed migration.

## Build locally

```
npm ci
npm run package:installer
```

Outputs are copied to `release/installer/`: the NSIS setup EXE, its `.blockmap`, `latest.yml`, and `win-unpacked/` for verification. Builds use an explicit source/runtime allowlist and temporary extraction outside OneDrive. Local packaging never publishes anything. `npm run package:desktop` continues producing the portable ZIP.

## Publish an update

1. Update `package.json` and the lockfile together (`npm version X.Y.Z --no-git-tag-version`). The version must be higher than the published stable version.
2. Commit and push the release-ready changes.
3. Create and push the matching tag, for example `v0.6.0`.
4. `.github/workflows/release.yml` validates the tag/version, installs dependencies, runs tests, builds the installer, smoke-tests the staged app, and uploads the EXE, blockmap, and `latest.yml` to a **draft** GitHub release.
5. Download and test the installer, inspect the release assets, then manually publish the draft. Only then do users discover it. Never publish metadata from a different build or omit its matching EXE/blockmap. The workflow refuses to overwrite an already published release.

The tag workflow uses GitHub's short-lived `GITHUB_TOKEN` with release-write permission only in its job; no publishing token is included in the app. Initial setup requires Actions to be enabled. The existing ZIP-only release does not contain update metadata, so checks can report unavailable until the first installer release is published.

## Signing and verification

Configure Actions secrets `WINDOWS_CSC_LINK` (a code-signing certificate/PFX accepted by electron-builder) and `WINDOWS_CSC_KEY_PASSWORD` to sign releases. Without them, installers are unsigned and Windows may show warnings. Download checksum verification is provided by electron-updater; publisher-signature verification is available when builds are signed. Checksums alone do not authenticate a compromised release feed. Signing is strongly recommended before distributing auto-updates broadly; keep the signing identity stable.

Before rollout, test a real installed upgrade from an older installer version to a higher version on a disposable Windows account/VM. Confirm restart consent, preserved data, and recovery from failed downloads. Unit tests and an unpacked smoke test do not replace this two-version installed test. Do not use your live automation session for installation testing.

References: [electron-updater](https://www.electron.build/v26/docs/features/auto-update/), [NSIS](https://www.electron.build/v26/docs/nsis/).
