# dsh-packager

Non-invasive out-of-box packager for `deepseek-harness` (`dsh`). Specify `DSH_DIR` and build a desktop installer without patching `dsh` source. Plugin hot-plug (`dsh plugin add`) stays outside the bundle via `$DSH_HOME/profiles/<name>/node_modules`.

This repo is intended to be added as a **top-level submodule** to `dsh-hub`:

```sh
git submodule add https://github.com/<you>/dsh-packager.git packagers/dsh-packager
```

`dsh-hub` itself is pointer-only (`AGENTS.md`), so no build artifacts or binaries are committed there.

## Usage

```sh
pnpm install
pnpm run build -- --dsh-dir ../deepseek-harness
# or
DSH_DIR=/path/to/deepseek-harness pnpm run build

pnpm run dist        # current platform
pnpm run dist:win    # NSIS (requires admin/Developer Mode for winCodeSign symlink)
pnpm run dist:mac    # dmg
pnpm run dist:linux  # AppImage+deb
# artifacts -> dist/
```

`--skip-build` skips `pnpm --dir $DSH_DIR run build` if `apps/cli/lib/bin.js` and `apps/web/dist` already exist.

## How it preserves plugins

* `resources/dsh` is `extraResources` (outside `asar`). `DSH_HOME` stays at default `~/.dsh` (`packages/util/home-paths/src/index.ts:resolveDshHome`), so existing profiles/plugins are shared — zero impact for users who already have `dsh`.
* `healProfilesModuleFallback` and `reconcilePlugins` (`apps/cli/src/profile-boot.ts:99`, `apps/cli/src/plugin.ts:59`) still resolve out-of-tree bundles from `profile/node_modules`.
* To isolate, launch with `DSH_HOME=$APP_USER_DATA/dsh`.

## Releases

Publish installers via GitHub Releases of this repo (electron-builder `publish:github`), not as git objects in `dsh-hub`. Link releases from `dsh-hub/README.md`.

## Requires

* Node `^22.19 || >=24`, `pnpm@11.7.0` (same as harness)
* `dsh` built artifacts (`pnpm --dir $DSH_DIR run build`)
