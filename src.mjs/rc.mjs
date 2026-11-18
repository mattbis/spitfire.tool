import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

const RC_FILENAMES = ['.spitfirememrc', '.spfmrc'];

/**
 * Expands leading ~ or %ENV_VAR% / $ENV_VAR tokens in a path string.
 */
function expandPath(rawPath) {
  if (!rawPath) return rawPath;
  let result = rawPath.trim();

  if (result.startsWith('~/') || result.startsWith('~\\') || result === '~') {
    result = path.join(os.homedir(), result.slice(1));
  }

  // Expand Windows %VAR%
  result = result.replace(/%([^%]+)%/g, (_, name) => process.env[name] ?? `%${name}%`);

  // Expand POSIX $VAR or ${VAR}
  result = result.replace(/\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g, (_, name) => process.env[name] ?? '');

  return path.resolve(result);
}

/**
 * Parses a key = value or key , value .rc file into an object.
 */
export function parseRcFile(rcPath) {
  const cfg = {};
  if (!fs.existsSync(rcPath)) return cfg;

  const content = fs.readFileSync(rcPath, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;

    const match = line.match(/^([A-Za-z0-9_.-]+)\s*(?:=|,|:)\s*(.+)$/);
    if (!match) continue;

    const key = match[1].trim().toLowerCase();
    const val = match[2].trim().replace(/^["']|["']$/g, '');
    cfg[key] = val;
  }
  return cfg;
}

/**
 * Finds the active .rc file in priority order:
 *  1. SPITFIRE_RC environment variable
 *  2. Current working directory (.spitfirememrc or .spfmrc)
 *  3. Project root directory (i:\proc\au\spitfire.tool\.spitfirememrc)
 *  4. User home directory (~/.spitfirememrc or ~/.spfmrc)
 */
export function findRcFile() {
  if (process.env.SPITFIRE_RC && fs.existsSync(process.env.SPITFIRE_RC)) {
    return path.resolve(process.env.SPITFIRE_RC);
  }

  const searchDirs = [process.cwd(), PROJECT_ROOT, os.homedir()];
  for (const dir of searchDirs) {
    for (const name of RC_FILENAMES) {
      const candidate = path.join(dir, name);
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }
  return null;
}

/**
 * Resolves runtime paths using:
 *  1. Environment variables (SPITFIRE_ETC_DIR, SPITFIRE_APPDATA_DIR)
 *  2. Discovered .spitfirememrc / .spfmrc file
 *  3. Generic cross-machine OS defaults (~/.spitfiremem/settings and %APPDATA%/Spitfire Audio/Settings)
 */
export function loadRuntimeConfig() {
  const rcFile = findRcFile();
  const rc = rcFile ? parseRcFile(rcFile) : {};

  const defaultAppData =
    process.platform === 'win32'
      ? path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Spitfire Audio', 'Settings')
      : path.join(os.homedir(), 'Library', 'Application Support', 'Spitfire Audio', 'Settings');

  const defaultEtcDir = path.join(os.homedir(), '.spitfiremem', 'settings');

  const etcDirRaw =
    process.env.SPITFIRE_ETC_DIR ||
    rc.etc_dir ||
    rc.settings_dir ||
    rc.config_dir ||
    defaultEtcDir;

  const appDataDirRaw =
    process.env.SPITFIRE_APPDATA_DIR ||
    rc.appdata_dir ||
    rc.spitfire_settings_dir ||
    rc.live_dir ||
    defaultAppData;

  return {
    rcFile,
    etcDir: expandPath(etcDirRaw),
    appDataDir: expandPath(appDataDirRaw),
    defaultTag: rc.default_tag || 'default',
  };
}
