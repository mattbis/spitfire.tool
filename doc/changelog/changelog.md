# Changelog

All notable changes to **`spitfiremem`** (`spfm` / `spitfire-mem-tool`) are documented in this file.

## [1.0.0] - 2026-11-18

### Added
- **Core JUCE XML Patcher (`src-mjs.dev/juce-xml.mjs`)**:
  - Lossless, zero-dependency reader and surgical updater for JUCE `<PROPERTIES>` `.settings` files (`defaultPreloadSize` and `defaultBufferSize`).
  - Only writes to disk when values actually change, preserving exact XML headers, attribute formatting, and line endings.
- **Column-Aligned Configuration System (`src-mjs.dev/conf.mjs`)**:
  - Automatic column-aligned `.conf` parser and formatter (`# plugin , preload , buffer` and `# alias , settings_file`).
  - Per-plugin tag resolution with automatic fallback to `default.conf` (plus `*` wildcard support).
- **Runtime `.rc` Configuration (`src-mjs.dev/rc.mjs`)**:
  - Support for `.spitfirememrc` / `.spfmrc` (searched in current working directory, project root, and `~`, or via `SPITFIRE_RC`) so machine-specific paths (`etc_dir`, `appdata_dir`, `default_tag`) are never hardcoded.
  - Added `.spitfirememrc.example` and `.gitignore`.
- **CLI Commands (`src-mjs.dev/cli.mjs`)**:
  - `init`: Imports live `%APPDATA%\Spitfire Audio\Settings\*.settings` values into `default.conf` and seeds short plugin aliases in `aliases.conf`.
  - `status`: Displays active tag, resolved `.rc` paths, live XML values, active tag target, and drift status (`OK`, `OK (default)`, `DRIFT`).
  - `set` / `unset` / `get`: Per-plugin (or `*`) preload and buffer updates with `(y/n)` confirmation prompt when modifying `default.conf`.
  - `tag` (`list`, `use`, `create`, `sync`) and top-level `use <tag>`: Tag creation, profile switching, and syncing live UI tweaks back into `.conf`.
  - `alias` (`list`, `set`, `rm`): Short CLI alias management for `.settings` files.
- **Shell & Windows Launchers (`sh/`)**:
  - Added `.sh` and `.cmd` launchers for `spfm`, `spitfiremem`, and `spitfire-mem-tool`.
- **Documentation**:
  - Added `README.md` explaining JUCE preload/buffer mechanics, `.spitfirememrc` resolution, `.conf` format, and CLI usage.
