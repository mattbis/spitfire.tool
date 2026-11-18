# spitfiremem (`spfm` / `spitfire-mem-tool`)

A zero-dependency Node.js CLI tool to manage and switch **Spitfire Audio** plugin memory settings (`defaultPreloadSize` and `defaultBufferSize`) across multiple project profiles ("tags") without overwriting full `.settings` files.

---

## Why This Exists

Spitfire Audio's in-house JUCE-based sampler plugins store global per-library preferences in `%APPDATA%\Spitfire Audio\Settings\*.settings` as XML `<PROPERTIES>`:

```xml
<PROPERTIES>
  <VALUE name="defaultPreloadSize" val="18880"/>
  <VALUE name="defaultBufferSize" val="198500"/>
</PROPERTIES>
```

* **`defaultPreloadSize` (Audio Samples in RAM per zone/mic):** Controls how many samples of the initial attack of every sample zone are permanently pinned in RAM. In massive orchestral templates with many separate plugin instances (e.g. one instance per articulation/technique), default preload values (`18880`+) can consume gigabytes of idle RAM. Lowering this (e.g. `3000`–`4000`) drastically reduces the project's RAM footprint.
* **`defaultBufferSize` (Audio Samples per streaming voice):** Controls the disk-streaming ring buffer size in JUCE's background stream thread.

Instead of swapping entire `.settings` files (which risks clobbering plugin updates, window scaling, default presets, or newly added JUCE properties), **`spitfiremem` surgically patches only `defaultPreloadSize` and `defaultBufferSize` in-place**, and only writes to disk when a value actually changes.

---

## Directory Structure

```text
spitfire.tool/
├── sh/
│   ├── spfm.sh / spfm.cmd                        # Short CLI launcher
│   ├── spitfiremem.sh / spitfiremem.cmd          # Project-named CLI launcher
│   └── spitfire-mem-tool.sh / .cmd               # Full-named CLI launcher
├── src.mjs/
│   ├── cli.mjs                                   # CLI command router
│   ├── conf.mjs                                  # Column-aligned .conf parser/writer
│   ├── juce-xml.mjs                              # Lossless JUCE <PROPERTIES> XML reader/patcher
│   └── rc.mjs                                    # Runtime .spitfirememrc / .spfmrc config loader
├── .spitfirememrc.example                        # Template runtime path configuration
└── package.json
```

---

## Configuration (`.spitfirememrc` / `.spfmrc`)

No personal paths are hardcoded in the source code. At startup, `spitfiremem` resolves paths in the following priority order:

1. **Environment variables:** `SPITFIRE_ETC_DIR`, `SPITFIRE_APPDATA_DIR`, `SPITFIRE_RC`
2. **`.spitfirememrc` (or `.spfmrc`)** searched in:
   * Current working directory
   * Project root directory (`spitfire.tool/.spitfirememrc`)
   * User home directory (`~/.spitfirememrc`)
3. **Cross-platform fallback defaults:**
   * `etc_dir`: `~/.spitfiremem/settings`
   * `appdata_dir`: `%APPDATA%\Spitfire Audio\Settings` (Windows) or `~/Library/Application Support/Spitfire Audio/Settings` (macOS)

### Example `.spitfirememrc`

```ini
# key        , value
etc_dir      , I:\etc\au\spitfire\settings
appdata_dir  , %APPDATA%\Spitfire Audio\Settings
default_tag  , default
```

*(Note: `.spitfirememrc` is git-ignored so machine-specific paths stay local; see `.spitfirememrc.example`).*

---

## Config Files Inside `etc_dir`

All configuration files in `etc_dir` use a clean, automatically column-aligned format:

1. **`default.conf`** — Baseline values imported when you run `spfm init`. Used as the per-plugin fallback whenever the active tag does not override a specific plugin.
   ```ini
   # plugin                                              , preload , buffer
   Abbey Road One.settings                               , 4000    , 78036
   BBC Symphony Orchestra.settings                       , 18880   , 198500
   ```
2. **`<tag>.conf`** (e.g. `cwd.conf`, `dwd.conf`, `normal.conf`) — Per-project overrides. Only plugins that differ from `default.conf` need to be listed (or use `*` as a wildcard default for that tag).
3. **`aliases.conf`** — Maps short aliases to `.settings` filenames for fast CLI typing:
   ```ini
   # alias  , settings_file
   aro      , Abbey Road One.settings
   bbcso    , BBC Symphony Orchestra.settings
   ewc      , Eric Whitacre Choir.settings
   ```
4. **`active_tag`** — Tracks the currently active tag name.

---

## CLI Usage (`spfm`)

You can invoke the tool via `spfm`, `spitfiremem`, or `spitfire-mem-tool`.

### 1. Initialize Baseline & Aliases
```bash
spfm init
```
Reads all live `*.settings` files from `appdata_dir`, writes `default.conf`, and generates initial short aliases in `aliases.conf`.

### 2. View Status & Drift Detection
```bash
spfm status
```
Displays the active tag, resolved `.rc` paths, and a column-aligned table showing every plugin's alias, live XML values, active tag target, and whether the live file is `OK`, `OK (default)`, or in `DRIFT` (modified externally in the plugin UI).

### 3. Create & Switch Tags (`cwd`, `dwd`, `normal`, `default`)
```bash
# Create a new tag (inherits from default.conf until overridden, or clone with --from <tag|live>)
spfm tag create cwd
spfm tag create normal

# Switch active tag and patch any changed .settings files
spfm use cwd
spfm use normal
spfm use default

# List all tags
spfm tag list

# Pull live changes made inside the Spitfire UI into the active tag's .conf
spfm tag sync
```

### 4. Set & Inspect Plugin Values
```bash
# Set preload and buffer for a plugin on the active tag (and patch live XML immediately)
spfm set bbcso 2000, 198500

# Set values for a specific tag without switching to it
spfm set bbcso 18880, 198500 --tag normal

# Set wildcard default for all plugins in a tag
spfm set * 18880, 198500 --tag normal

# Remove a plugin override from the active tag and revert it to default.conf
spfm unset bbcso

# Inspect a single plugin's live values and its values across all tags
spfm get bbcso
```
*(Safety check: If you run `spfm set` while the `default` tag is active, it prompts `(y/n)` before modifying `default.conf`).*

### 5. Manage Aliases
```bash
# List all aliases
spfm alias list

# Set or rename an alias for a settings file
spfm alias set "BBC Symphony Orchestra.settings" bbcso

# Remove an alias
spfm alias rm bbcso
```
