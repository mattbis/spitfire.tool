#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { getPreloadAndBuffer, setPreloadAndBuffer } from './juce-xml.mjs';
import {
  normalizeSettingsFileName,
  readTagConf,
  writeTagConf,
  readAliasesConf,
  writeAliasesConf,
  suggestDefaultAlias,
} from './conf.mjs';
import { loadRuntimeConfig } from './rc.mjs';

const RUNTIME_CFG = loadRuntimeConfig();
const APPDATA_SETTINGS_DIR = RUNTIME_CFG.appDataDir;
const ETC_SETTINGS_DIR = RUNTIME_CFG.etcDir;
const RC_FILE_USED = RUNTIME_CFG.rcFile;

const ACTIVE_TAG_FILE = path.join(ETC_SETTINGS_DIR, 'active_tag');
const ALIASES_FILE = path.join(ETC_SETTINGS_DIR, 'aliases.conf');
const DEFAULT_TAG = RUNTIME_CFG.defaultTag || 'default';

function ensureEtcDir() {
  if (!fs.existsSync(ETC_SETTINGS_DIR)) {
    fs.mkdirSync(ETC_SETTINGS_DIR, { recursive: true });
  }
}

function getTagConfPath(tag) {
  return path.join(ETC_SETTINGS_DIR, `${tag}.conf`);
}

function getActiveTag() {
  if (!fs.existsSync(ACTIVE_TAG_FILE)) return DEFAULT_TAG;
  const tag = fs.readFileSync(ACTIVE_TAG_FILE, 'utf8').trim();
  return tag || DEFAULT_TAG;
}

function setActiveTag(tag) {
  ensureEtcDir();
  fs.writeFileSync(ACTIVE_TAG_FILE, `${tag}\r\n`, 'utf8');
}

function listLiveSettingsFiles() {
  if (!fs.existsSync(APPDATA_SETTINGS_DIR)) {
    throw new Error(`Spitfire Settings directory not found: ${APPDATA_SETTINGS_DIR}`);
  }
  return fs
    .readdirSync(APPDATA_SETTINGS_DIR)
    .filter((f) => f.toLowerCase().endsWith('.settings'))
    .sort((a, b) => a.localeCompare(b));
}

function listAvailableTags() {
  ensureEtcDir();
  return fs
    .readdirSync(ETC_SETTINGS_DIR)
    .filter((f) => f.toLowerCase().endsWith('.conf') && f.toLowerCase() !== 'aliases.conf')
    .map((f) => f.replace(/\.conf$/i, ''))
    .sort((a, b) => {
      if (a === DEFAULT_TAG) return -1;
      if (b === DEFAULT_TAG) return 1;
      return a.localeCompare(b);
    });
}

function askYesNo(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(`${question} (y/n): `, (answer) => {
      rl.close();
      const normalized = answer.trim().toLowerCase();
      resolve(normalized === 'y' || normalized === 'yes');
    });
  });
}

/**
 * Resolves a user query (alias, filename with or without .settings) to the canonical .settings filename.
 */
function resolveTargetFile(query, aliasesMap, liveFiles) {
  if (query === '*') return '*';

  const qLower = query.trim().toLowerCase();

  // 1. Exact alias match
  if (aliasesMap.has(qLower)) {
    return aliasesMap.get(qLower);
  }

  // 2. Exact filename match (case-insensitive, with or without .settings)
  const normQuery = normalizeSettingsFileName(query).toLowerCase();
  for (const file of liveFiles) {
    if (file.toLowerCase() === normQuery) {
      return file;
    }
  }

  // 3. Unique substring match on filename or alias
  const substringMatches = liveFiles.filter((f) =>
    f.toLowerCase().replace(/\.settings$/i, '').includes(qLower)
  );
  if (substringMatches.length === 1) {
    return substringMatches[0];
  }

  throw new Error(
    `Could not resolve plugin "${query}". Run "spitfire-mem-tool alias list" to see available aliases and files.`
  );
}

/**
 * Resolves the target { preload, buffer, source } for a given plugin under a given tag.
 * Fallback order:
 *  1. Specific file entry in <tag>.conf
 *  2. Wildcard '*' entry in <tag>.conf
 *  3. Specific file entry in default.conf
 *  4. Wildcard '*' entry in default.conf
 */
function resolveTagTarget(fileName, tag, tagMap, defaultMap) {
  if (tagMap.has(fileName)) {
    return { ...tagMap.get(fileName), source: tag };
  }
  if (tagMap.has('*')) {
    return { ...tagMap.get('*'), source: `${tag}(*)` };
  }
  if (defaultMap.has(fileName)) {
    return { ...defaultMap.get(fileName), source: DEFAULT_TAG };
  }
  if (defaultMap.has('*')) {
    return { ...defaultMap.get('*'), source: `${DEFAULT_TAG}(*)` };
  }
  return null;
}

function getReverseAliasMap(aliasesMap) {
  const rev = new Map();
  for (const [alias, file] of aliasesMap.entries()) {
    rev.set(file, alias);
  }
  return rev;
}

/**
 * COMMAND: init
 * Reads current live .settings files to create default.conf and aliases.conf
 */
async function cmdInit(args) {
  ensureEtcDir();
  const force = args.includes('--force') || args.includes('-f');
  const defaultConfPath = getTagConfPath(DEFAULT_TAG);
  const liveFiles = listLiveSettingsFiles();

  if (fs.existsSync(defaultConfPath) && !force) {
    const ok = await askYesNo(
      `default.conf already exists at ${defaultConfPath}. Overwrite with current live values?`
    );
    if (!ok) {
      console.log('Aborted init.');
      return;
    }
  }

  const defaultMap = new Map();
  for (const file of liveFiles) {
    const xml = fs.readFileSync(path.join(APPDATA_SETTINGS_DIR, file), 'utf8');
    const { preload, buffer } = getPreloadAndBuffer(xml);
    defaultMap.set(file, {
      preload: preload ?? '18880',
      buffer: buffer ?? '198500',
    });
  }

  writeTagConf(defaultConfPath, defaultMap);
  console.log(`Saved ${defaultMap.size} plugins to ${defaultConfPath}`);

  // Seed aliases.conf (preserving any existing aliases)
  const aliasesMap = readAliasesConf(ALIASES_FILE);
  const reverseAliases = getReverseAliasMap(aliasesMap);
  const usedAliases = new Set(aliasesMap.keys());
  let addedAliases = 0;

  for (const file of liveFiles) {
    if (!reverseAliases.has(file)) {
      const alias = suggestDefaultAlias(file, usedAliases);
      aliasesMap.set(alias, file);
      usedAliases.add(alias);
      addedAliases++;
    }
  }
  writeAliasesConf(ALIASES_FILE, aliasesMap);
  if (addedAliases > 0) {
    console.log(`Generated ${addedAliases} aliases in ${ALIASES_FILE}`);
  }

  if (!fs.existsSync(ACTIVE_TAG_FILE)) {
    setActiveTag(DEFAULT_TAG);
    console.log(`Active tag initialized to "${DEFAULT_TAG}"`);
  }
}

/**
 * COMMAND: status
 * Prints column-aligned table of all plugins, live values, active tag target, and status.
 */
function cmdStatus() {
  ensureEtcDir();
  const activeTag = getActiveTag();
  const liveFiles = listLiveSettingsFiles();
  const aliasesMap = readAliasesConf(ALIASES_FILE);
  const revAliases = getReverseAliasMap(aliasesMap);
  const defaultMap = readTagConf(getTagConfPath(DEFAULT_TAG));
  const tagMap =
    activeTag === DEFAULT_TAG ? defaultMap : readTagConf(getTagConfPath(activeTag));

  console.log(`Active Tag : ${activeTag}`);
  console.log(`RC File    : ${RC_FILE_USED || '(none - using defaults)'}`);
  console.log(`Config Dir : ${ETC_SETTINGS_DIR}`);
  console.log(`AppData Dir: ${APPDATA_SETTINGS_DIR}\n`);

  const rows = liveFiles.map((file) => {
    const alias = revAliases.get(file) || '-';
    const xml = fs.readFileSync(path.join(APPDATA_SETTINGS_DIR, file), 'utf8');
    const live = getPreloadAndBuffer(xml);
    const target = resolveTagTarget(file, activeTag, tagMap, defaultMap);

    let state = 'UNTRACKED';
    if (target) {
      const matches =
        String(live.preload) === String(target.preload) &&
        String(live.buffer) === String(target.buffer);
      if (matches) {
        state = target.source === DEFAULT_TAG && activeTag !== DEFAULT_TAG ? 'OK (default)' : 'OK';
      } else {
        state = `DRIFT (expected ${target.preload}, ${target.buffer})`;
      }
    }

    return {
      alias,
      file,
      preload: String(live.preload ?? '-'),
      buffer: String(live.buffer ?? '-'),
      source: target ? target.source : '-',
      state,
    };
  });

  const wAlias = Math.max('alias'.length, ...rows.map((r) => r.alias.length));
  const wFile = Math.max('# plugin'.length, ...rows.map((r) => r.file.length));
  const wPreload = Math.max('preload'.length, ...rows.map((r) => r.preload.length));
  const wBuffer = Math.max('buffer'.length, ...rows.map((r) => r.buffer.length));
  const wSource = Math.max('source'.length, ...rows.map((r) => r.source.length));

  const header = [
    'alias'.padEnd(wAlias),
    '# plugin'.padEnd(wFile),
    'preload'.padEnd(wPreload),
    'buffer'.padEnd(wBuffer),
    'source'.padEnd(wSource),
    'status',
  ].join(' , ');

  console.log(header);
  console.log('-'.repeat(header.length));

  for (const r of rows) {
    console.log(
      [
        r.alias.padEnd(wAlias),
        r.file.padEnd(wFile),
        r.preload.padEnd(wPreload),
        r.buffer.padEnd(wBuffer),
        r.source.padEnd(wSource),
        r.state,
      ].join(' , ')
    );
  }
}

/**
 * Applies a tag's configuration across all live .settings files, only writing files that changed.
 */
function applyTagToLiveFiles(tag) {
  const defaultConfPath = getTagConfPath(DEFAULT_TAG);
  if (!fs.existsSync(defaultConfPath)) {
    throw new Error(`default.conf not found. Run "spitfire-mem-tool init" first.`);
  }

  const tagConfPath = getTagConfPath(tag);
  if (tag !== DEFAULT_TAG && !fs.existsSync(tagConfPath)) {
    throw new Error(
      `Tag "${tag}" does not exist (${tagConfPath}). Create it with "spitfire-mem-tool tag create ${tag}" or "spitfire-mem-tool set ... --tag ${tag}".`
    );
  }

  const defaultMap = readTagConf(defaultConfPath);
  const tagMap = tag === DEFAULT_TAG ? defaultMap : readTagConf(tagConfPath);
  const liveFiles = listLiveSettingsFiles();

  let updatedCount = 0;
  let unchangedCount = 0;

  for (const file of liveFiles) {
    const target = resolveTagTarget(file, tag, tagMap, defaultMap);
    if (!target) continue;

    const fullPath = path.join(APPDATA_SETTINGS_DIR, file);
    const xml = fs.readFileSync(fullPath, 'utf8');
    const result = setPreloadAndBuffer(xml, target.preload, target.buffer);

    if (result.changed) {
      fs.writeFileSync(fullPath, result.xml, 'utf8');
      updatedCount++;
      console.log(
        `  [UPDATED] ${file.padEnd(52)} : (${result.oldPreload}, ${result.oldBuffer}) -> (${target.preload}, ${target.buffer}) [${target.source}]`
      );
    } else {
      unchangedCount++;
    }
  }

  setActiveTag(tag);
  console.log(
    `\nSwitched active tag to "${tag}". Updated ${updatedCount} file(s), ${unchangedCount} unchanged.`
  );
}

/**
 * COMMAND: set <alias|file|*> <preload>, <buffer> [--tag <tag>] [-y]
 */
async function cmdSet(args) {
  ensureEtcDir();

  // Extract optional --tag <tag> and -y / --yes flags
  let explicitTag = null;
  let autoYes = false;
  const positional = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--tag' || arg === '-t') {
      explicitTag = args[++i];
      if (!explicitTag) throw new Error('Missing tag name after --tag');
    } else if (arg === '-y' || arg === '--yes') {
      autoYes = true;
    } else {
      positional.push(arg);
    }
  }

  if (positional.length < 2) {
    throw new Error(
      'Usage: spitfire-mem-tool set <alias|file|*> <preload>, <buffer> [--tag <tag>]'
    );
  }

  const targetQuery = positional[0];
  // Support "2000, 198500", "2000,198500", or "2000 198500"
  const numTokens = positional
    .slice(1)
    .join(' ')
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (numTokens.length < 2) {
    throw new Error(
      'Please provide both preload and buffer values, e.g.: spitfire-mem-tool set bbcso 2000, 198500'
    );
  }

  const [preload, buffer] = numTokens;
  if (!/^\d+$/.test(preload) || !/^\d+$/.test(buffer)) {
    throw new Error(
      `Invalid preload/buffer numbers: preload="${preload}", buffer="${buffer}". Both must be positive integers.`
    );
  }

  const activeTag = getActiveTag();
  const targetTag = explicitTag || activeTag;

  // Prompt if modifying 'default' tag
  if (targetTag === DEFAULT_TAG && !autoYes) {
    const confirmed = await askYesNo(
      `Active tag is "${DEFAULT_TAG}". Are you sure you want to modify default.conf baseline values?`
    );
    if (!confirmed) {
      console.log(
        'Aborted. Tip: switch to or create a project tag first (e.g., "spitfire-mem-tool tag use cwd") or pass "--tag cwd".'
      );
      return;
    }
  }

  const aliasesMap = readAliasesConf(ALIASES_FILE);
  const liveFiles = listLiveSettingsFiles();
  const targetFile = resolveTargetFile(targetQuery, aliasesMap, liveFiles);

  const tagConfPath = getTagConfPath(targetTag);
  const tagMap = readTagConf(tagConfPath);
  tagMap.set(targetFile, { preload, buffer });
  writeTagConf(tagConfPath, tagMap);

  console.log(
    `Saved to ${targetTag}.conf: ${targetFile} -> preload=${preload}, buffer=${buffer}`
  );

  // If the edited tag is currently active, immediately patch the live .settings file(s)
  if (targetTag === activeTag) {
    const filesToPatch = targetFile === '*' ? liveFiles : [targetFile];
    const defaultMap = readTagConf(getTagConfPath(DEFAULT_TAG));

    for (const file of filesToPatch) {
      const resolved = resolveTagTarget(file, activeTag, tagMap, defaultMap);
      if (!resolved) continue;

      const fullPath = path.join(APPDATA_SETTINGS_DIR, file);
      if (!fs.existsSync(fullPath)) continue;

      const xml = fs.readFileSync(fullPath, 'utf8');
      const res = setPreloadAndBuffer(xml, resolved.preload, resolved.buffer);
      if (res.changed) {
        fs.writeFileSync(fullPath, res.xml, 'utf8');
        console.log(
          `Patched live ${file}: (${res.oldPreload}, ${res.oldBuffer}) -> (${resolved.preload}, ${resolved.buffer})`
        );
      } else {
        console.log(`Live ${file} already at (${resolved.preload}, ${resolved.buffer})`);
      }
    }
  }
}

/**
 * COMMAND: unset <alias|file> [--tag <tag>]
 */
function cmdUnset(args) {
  ensureEtcDir();
  let explicitTag = null;
  const positional = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--tag' || args[i] === '-t') {
      explicitTag = args[++i];
    } else {
      positional.push(args[i]);
    }
  }

  if (positional.length < 1) {
    throw new Error('Usage: spitfire-mem-tool unset <alias|file> [--tag <tag>]');
  }

  const activeTag = getActiveTag();
  const targetTag = explicitTag || activeTag;
  if (targetTag === DEFAULT_TAG) {
    throw new Error('Cannot unset entries from default.conf.');
  }

  const aliasesMap = readAliasesConf(ALIASES_FILE);
  const liveFiles = listLiveSettingsFiles();
  const targetFile = resolveTargetFile(positional[0], aliasesMap, liveFiles);

  const tagConfPath = getTagConfPath(targetTag);
  const tagMap = readTagConf(tagConfPath);

  if (!tagMap.has(targetFile)) {
    console.log(`${targetFile} is not overridden in ${targetTag}.conf`);
    return;
  }

  tagMap.delete(targetFile);
  writeTagConf(tagConfPath, tagMap);
  console.log(`Removed ${targetFile} override from ${targetTag}.conf`);

  if (targetTag === activeTag && targetFile !== '*') {
    const defaultMap = readTagConf(getTagConfPath(DEFAULT_TAG));
    const fallback = resolveTagTarget(targetFile, activeTag, tagMap, defaultMap);
    if (fallback) {
      const fullPath = path.join(APPDATA_SETTINGS_DIR, targetFile);
      const xml = fs.readFileSync(fullPath, 'utf8');
      const res = setPreloadAndBuffer(xml, fallback.preload, fallback.buffer);
      if (res.changed) {
        fs.writeFileSync(fullPath, res.xml, 'utf8');
        console.log(
          `Reverted live ${targetFile} to ${fallback.source}: (${res.oldPreload}, ${res.oldBuffer}) -> (${fallback.preload}, ${fallback.buffer})`
        );
      }
    }
  }
}

/**
 * COMMAND: get [alias|file]
 */
function cmdGet(args) {
  if (args.length === 0) {
    cmdStatus();
    return;
  }

  const aliasesMap = readAliasesConf(ALIASES_FILE);
  const revAliases = getReverseAliasMap(aliasesMap);
  const liveFiles = listLiveSettingsFiles();
  const targetFile = resolveTargetFile(args[0], aliasesMap, liveFiles);

  const fullPath = path.join(APPDATA_SETTINGS_DIR, targetFile);
  const xml = fs.readFileSync(fullPath, 'utf8');
  const live = getPreloadAndBuffer(xml);
  const activeTag = getActiveTag();
  const tags = listAvailableTags();

  console.log(`Plugin     : ${targetFile}`);
  console.log(`Alias      : ${revAliases.get(targetFile) || '-'}`);
  console.log(`Live XML   : preload = ${live.preload} , buffer = ${live.buffer}`);
  console.log(`Active Tag : ${activeTag}\n`);

  const defaultMap = readTagConf(getTagConfPath(DEFAULT_TAG));
  const rows = tags.map((tag) => {
    const tagMap = tag === DEFAULT_TAG ? defaultMap : readTagConf(getTagConfPath(tag));
    const resolved = resolveTagTarget(targetFile, tag, tagMap, defaultMap);
    return {
      tag: tag === activeTag ? `* ${tag}` : `  ${tag}`,
      preload: resolved ? resolved.preload : '-',
      buffer: resolved ? resolved.buffer : '-',
      source: resolved ? resolved.source : '-',
    };
  });

  const wTag = Math.max('# tag'.length, ...rows.map((r) => r.tag.length));
  const wPre = Math.max('preload'.length, ...rows.map((r) => r.preload.length));
  const wBuf = Math.max('buffer'.length, ...rows.map((r) => r.buffer.length));

  console.log(`${'# tag'.padEnd(wTag)} , ${'preload'.padEnd(wPre)} , ${'buffer'.padEnd(wBuf)} , source`);
  for (const r of rows) {
    console.log(
      `${r.tag.padEnd(wTag)} , ${r.preload.padEnd(wPre)} , ${r.buffer.padEnd(wBuf)} , ${r.source}`
    );
  }
}

/**
 * COMMAND: alias [list | set <settings_file> <alias> | rm <alias>]
 */
function cmdAlias(args) {
  ensureEtcDir();
  const sub = (args[0] || 'list').toLowerCase();
  const aliasesMap = readAliasesConf(ALIASES_FILE);

  if (sub === 'list' || sub === 'ls') {
    const rows = [];
    for (const [alias, settingsFile] of aliasesMap.entries()) {
      rows.push({ alias, settingsFile });
    }
    rows.sort((a, b) => a.settingsFile.localeCompare(b.settingsFile));

    const wAlias = Math.max('# alias'.length, ...rows.map((r) => r.alias.length));
    console.log(`${'# alias'.padEnd(wAlias)} , settings_file`);
    for (const r of rows) {
      console.log(`${r.alias.padEnd(wAlias)} , ${r.settingsFile}`);
    }
    return;
  }

  if (sub === 'set') {
    if (args.length < 3) {
      throw new Error('Usage: spitfire-mem-tool alias set "<settings file or existing alias>" <new_alias>');
    }
    const newAlias = args[args.length - 1].trim().toLowerCase();
    const fileQuery = args.slice(1, -1).join(' ').trim();
    const liveFiles = listLiveSettingsFiles();
    const targetFile = resolveTargetFile(fileQuery, aliasesMap, liveFiles);

    // Remove any existing alias pointing to this file so each file has one canonical alias
    for (const [existingAlias, mappedFile] of aliasesMap.entries()) {
      if (mappedFile.toLowerCase() === targetFile.toLowerCase()) {
        aliasesMap.delete(existingAlias);
      }
    }

    aliasesMap.set(newAlias, targetFile);
    writeAliasesConf(ALIASES_FILE, aliasesMap);
    console.log(`Alias set: ${newAlias} -> ${targetFile}`);
    return;
  }

  if (sub === 'rm' || sub === 'remove' || sub === 'delete') {
    const targetAlias = (args[1] || '').trim().toLowerCase();
    if (!targetAlias) {
      throw new Error('Usage: spitfire-mem-tool alias rm <alias>');
    }
    if (!aliasesMap.has(targetAlias)) {
      throw new Error(`Alias "${targetAlias}" not found.`);
    }
    const file = aliasesMap.get(targetAlias);
    aliasesMap.delete(targetAlias);
    writeAliasesConf(ALIASES_FILE, aliasesMap);
    console.log(`Removed alias "${targetAlias}" (${file})`);
    return;
  }

  throw new Error(`Unknown alias subcommand "${sub}". Use: list, set, rm`);
}

/**
 * COMMAND: tag [list | use <tag> | create <tag> [--from <tag|live>] | sync]
 */
function cmdTag(args) {
  ensureEtcDir();
  const sub = (args[0] || 'list').toLowerCase();
  const activeTag = getActiveTag();

  if (sub === 'list' || sub === 'ls') {
    const tags = listAvailableTags();
    console.log('# Available Tags (* = active):');
    for (const t of tags) {
      const marker = t === activeTag ? '*' : ' ';
      const map = readTagConf(getTagConfPath(t));
      console.log(` ${marker} ${t.padEnd(15)} (${map.size} configured entries)`);
    }
    return;
  }

  if (sub === 'use' || sub === 'switch') {
    const targetTag = args[1];
    if (!targetTag) {
      throw new Error('Usage: spitfire-mem-tool tag use <tag>');
    }
    applyTagToLiveFiles(targetTag);
    return;
  }

  if (sub === 'create' || sub === 'new') {
    const newTag = args[1];
    if (!newTag) {
      throw new Error('Usage: spitfire-mem-tool tag create <tag> [--from <other_tag|live>]');
    }
    const confPath = getTagConfPath(newTag);
    if (fs.existsSync(confPath)) {
      throw new Error(`Tag "${newTag}" already exists at ${confPath}`);
    }

    let fromSource = null;
    const fromIdx = args.indexOf('--from');
    if (fromIdx !== -1 && args[fromIdx + 1]) {
      fromSource = args[fromIdx + 1];
    }

    const map = new Map();
    if (fromSource === 'live') {
      for (const file of listLiveSettingsFiles()) {
        const xml = fs.readFileSync(path.join(APPDATA_SETTINGS_DIR, file), 'utf8');
        const { preload, buffer } = getPreloadAndBuffer(xml);
        map.set(file, { preload: preload ?? '18880', buffer: buffer ?? '198500' });
      }
    } else if (fromSource) {
      const srcPath = getTagConfPath(fromSource);
      if (!fs.existsSync(srcPath)) {
        throw new Error(`Source tag "${fromSource}" does not exist.`);
      }
      for (const [k, v] of readTagConf(srcPath).entries()) {
        map.set(k, v);
      }
    }

    writeTagConf(confPath, map);
    console.log(
      `Created tag "${newTag}" (${confPath}) with ${map.size} entries${
        fromSource ? ` cloned from "${fromSource}"` : ' (inherits from default.conf until overridden)'
      }.`
    );
    return;
  }

  if (sub === 'sync' || sub === 'pull') {
    const targetTag = args[1] || activeTag;
    const confPath = getTagConfPath(targetTag);
    const defaultMap = readTagConf(getTagConfPath(DEFAULT_TAG));
    const tagMap = readTagConf(confPath);
    let synced = 0;

    for (const file of listLiveSettingsFiles()) {
      const xml = fs.readFileSync(path.join(APPDATA_SETTINGS_DIR, file), 'utf8');
      const live = getPreloadAndBuffer(xml);
      const currentTarget = resolveTagTarget(file, targetTag, tagMap, defaultMap);

      if (
        !currentTarget ||
        String(currentTarget.preload) !== String(live.preload) ||
        String(currentTarget.buffer) !== String(live.buffer)
      ) {
        tagMap.set(file, { preload: String(live.preload), buffer: String(live.buffer) });
        synced++;
        console.log(`  [SYNCED] ${file} -> (${live.preload}, ${live.buffer}) into ${targetTag}.conf`);
      }
    }

    writeTagConf(confPath, tagMap);
    console.log(`Synced ${synced} modified plugin(s) from live XML into ${targetTag}.conf.`);
    return;
  }

  // Allow shorthand: `spitfire-mem-tool tag <tagname>` to switch directly if <tagname>.conf exists
  if (fs.existsSync(getTagConfPath(sub))) {
    applyTagToLiveFiles(sub);
    return;
  }

  throw new Error(`Unknown tag subcommand "${sub}". Use: list, use, create, sync`);
}

function printHelp() {
  console.log(`spitfire-mem-tool — Spitfire Audio JUCE Preload & Buffer Tag Manager

Usage:
  spitfire-mem-tool init                                         Import live .settings into default.conf & seed aliases
  spitfire-mem-tool status                                       Show active tag, live XML values, and drift status
  spitfire-mem-tool set <alias|file|*> <preload>, <buffer>       Update active tag (prompts y/n if on default) & live XML
                  [--tag <tag>] [-y]
  spitfire-mem-tool unset <alias|file> [--tag <tag>]             Remove plugin override from tag & revert to default.conf
  spitfire-mem-tool get [alias|file]                             Show plugin's live values and values across all tags

Tag Commands:
  spitfire-mem-tool tag list                                     List all tags and show which is active
  spitfire-mem-tool tag use <tag>   (or: spitfire-mem-tool use <tag>)  Switch active tag and patch changed live .settings files
  spitfire-mem-tool tag create <tag> [--from <tag|live>]         Create a new tag .conf
  spitfire-mem-tool tag sync [tag]                               Pull any live UI changes from AppData into <tag>.conf

Alias Commands:
  spitfire-mem-tool alias list                                   List all short aliases -> .settings files
  spitfire-mem-tool alias set "<settings file>" <alias>          Assign or rename an alias for a .settings file
  spitfire-mem-tool alias rm <alias>                             Remove an alias
`);
}

async function main() {
  const args = process.argv.slice(2);
  const cmd = (args[0] || 'status').toLowerCase();
  const rest = args.slice(1);

  try {
    switch (cmd) {
      case 'init':
        await cmdInit(rest);
        break;
      case 'status':
      case 'st':
        cmdStatus();
        break;
      case 'set':
        await cmdSet(rest);
        break;
      case 'unset':
      case 'reset':
        cmdUnset(rest);
        break;
      case 'get':
        cmdGet(rest);
        break;
      case 'alias':
      case 'aliases':
        cmdAlias(rest);
        break;
      case 'tag':
      case 'tags':
        cmdTag(rest);
        break;
      case 'use':
      case 'switch':
        if (!rest[0]) throw new Error('Usage: spitfire-mem-tool use <tag>');
        applyTagToLiveFiles(rest[0]);
        break;
      case 'help':
      case '--help':
      case '-h':
        printHelp();
        break;
      default:
        throw new Error(`Unknown command "${cmd}". Run "spitfire-mem-tool --help" for usage.`);
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exitCode = 1;
  }
}

main();
