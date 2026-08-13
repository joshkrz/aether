# Dependency exceptions

This file records approved exceptions to the repository dependency policy. An exception must be removed when its upstream dependency chain supports a maintained replacement.

## `glob@10.5.0`

- **Status:** Approved temporarily on 2026-08-13.
- **Reason:** The current stable `nuxt@4.5.2` release depends on `@nuxt/nitro-server@4.5.2`, which depends on `nitropack@2.13.4` → `archiver@7.0.1` → `archiver-utils@5.0.2` → `glob@^10.0.0`.
- **Risk control:** The installed dependency tree reports no known vulnerabilities. No unsupported override is applied outside `archiver-utils`' declared range.
- **Removal condition:** Upgrade when the current stable Nuxt/Nitro chain no longer installs a deprecated `glob` release.

## Install scripts

- `esbuild@0.28.2` is explicitly approved because its post-install step prepares the platform-specific build binary used by the Nuxt/Vite toolchain.
- `fsevents@2.3.3` is explicitly approved because Vite's fallback watcher exceeded the macOS open-file limit during a development-server smoke test. Vite uses this native watcher for reliable hot reload.
- The older optional `fsevents@2.3.2` install script remains unapproved.
