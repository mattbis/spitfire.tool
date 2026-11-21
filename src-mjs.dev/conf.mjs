import fs from 'node:fs';

/**
 * Column-aligned .conf reader and writer.
 *
 * Tag .conf format:
 *   # plugin                                         , preload , buffer
 *   BBC Symphony Orchestra.settings                  , 18880   , 198500
 *
 * Aliases .conf format:
 *   # alias    , settings_file
 *   bbcso      , BBC Symphony Orchestra.settings
 */

export function normalizeSettingsFileName(name) {
  const trimmed = name.trim();
  if (trimmed === '*') return '*';
  return trimmed.toLowerCase().endsWith('.settings') ? trimmed : `${trimmed}.settings`;
}

/**
 * Parses a tag .conf file into a Map<settingsFileName, { preload: string, buffer: string }>
 */
export function readTagConf(filePath) {
  const map = new Map();
  if (!fs.existsSync(filePath)) return map;

  const content = fs.readFileSync(filePath, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const parts = line.split(',').map((s) => s.trim());
    if (parts.length < 3) continue;

    const fileKey = normalizeSettingsFileName(parts[0]);
    const preload = parts[1];
    const buffer = parts[2];
    map.set(fileKey, { preload, buffer });
  }
  return map;
}

/**
 * Writes a Map<settingsFileName, { preload: string, buffer: string }> to a column-aligned .conf file.
 */
export function writeTagConf(filePath, entriesMap) {
  const rows = [];
  for (const [plugin, { preload, buffer }] of entriesMap.entries()) {
    rows.push({
      plugin: String(plugin),
      preload: String(preload),
      buffer: String(buffer),
    });
  }

  // Sort with '*' first if present, then alphabetically by plugin name
  rows.sort((a, b) => {
    if (a.plugin === '*') return -1;
    if (b.plugin === '*') return 1;
    return a.plugin.localeCompare(b.plugin);
  });

  const col1Width = Math.max('# plugin'.length, ...rows.map((r) => r.plugin.length));
  const col2Width = Math.max('preload'.length, ...rows.map((r) => r.preload.length));

  const lines = [];
  lines.push(
    `${'# plugin'.padEnd(col1Width)} , ${'preload'.padEnd(col2Width)} , buffer`
  );

  for (const r of rows) {
    lines.push(
      `${r.plugin.padEnd(col1Width)} , ${r.preload.padEnd(col2Width)} , ${r.buffer}`
    );
  }

  fs.writeFileSync(filePath, lines.join('\r\n') + '\r\n', 'utf8');
}

/**
 * Parses aliases.conf into a Map<alias, settingsFileName>
 */
export function readAliasesConf(filePath) {
  const map = new Map();
  if (!fs.existsSync(filePath)) return map;

  const content = fs.readFileSync(filePath, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const commaIdx = line.indexOf(',');
    if (commaIdx === -1) continue;

    const alias = line.slice(0, commaIdx).trim().toLowerCase();
    const settingsFile = normalizeSettingsFileName(line.slice(commaIdx + 1));
    if (alias && settingsFile) {
      map.set(alias, settingsFile);
    }
  }
  return map;
}

/**
 * Writes Map<alias, settingsFileName> to a column-aligned aliases.conf file.
 */
export function writeAliasesConf(filePath, aliasesMap) {
  const rows = [];
  for (const [alias, settingsFile] of aliasesMap.entries()) {
    rows.push({ alias: alias.toLowerCase(), settingsFile });
  }

  rows.sort((a, b) => a. settingsFile.localeCompare(b.settingsFile));

  const col1Width = Math.max('# alias'.length, ...rows.map((r) => r.alias.length));
  const lines = [];
  lines.push(`${'# alias'.padEnd(col1Width)} , settings_file`);

  for (const r of rows) {
    lines.push(`${r.alias.padEnd(col1Width)} , ${r.settingsFile}`);
  }

  fs.writeFileSync(filePath, lines.join('\r\n') + '\r\n', 'utf8');
}

/**
 * Generates a sensible default short alias for a Spitfire .settings filename.
 */
export function suggestDefaultAlias(fileName, existingAliases = new Set()) {
  const base = fileName.replace(/\.settings$/i, '').trim();

  const knownPresets = {
    'Abbey Road One': 'aro',
    'BBC Symphony Orchestra': 'bbcso',
    'Darkstar - Haunted House': 'darkstar',
    'Eric Whitacre Choir Evo Grid': 'ewc-grid',
    'Eric Whitacre Choir': 'ewc',
    'Labs': 'labs',
    'Lea Bertucci - Acoustic Shadows': 'shadows',
    'Lea Bertucci - Xtended Vox': 'xvox',
    'Mabe Fratti and Concepcion Huerta - Estatica': 'estatica',
    'Nok Cultural Ensemble - Tape Percussion': 'nok',
    'Originals - Abe Laboriel Jr Drums': 'drums',
    'Originals - Epic Brass and Woodwinds': 'ebw',
    'Originals - Epic Choir': 'echoir',
    'Originals - Intimate Strings': 'istrings',
    'Originals - Wurli': 'wurli',
    'Solar': 'solar',
  };

  if (knownPresets[base] && !existingAliases.has(knownPresets[base])) {
    return knownPresets[base];
  }

  // Fallback slug generation
  const slug = base
    .toLowerCase()
    .replace(/^originals\s*-\s*/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  let candidate = slug || 'plugin';
  let counter = 2;
  while (existingAliases.has(candidate)) {
    candidate = `${slug}-${counter++}`;
  }
  return candidate;
}
