/**
 * Surgical JUCE <PROPERTIES> XML reader & writer.
 * Preserves exact whitespace, XML header, attribute spacing, and line endings.
 */

const PROP_PRELOAD = 'defaultPreloadSize';
const PROP_BUFFER = 'defaultBufferSize';

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Reads a single <VALUE name="..." val="..."/> property from a JUCE XML string.
 */
export function getJuceProp(xml, name) {
  const re = new RegExp(`<VALUE\\s+name="${escapeRegex(name)}"\\s+val="([^"]*)"\\s*/>`);
  const match = xml.match(re);
  return match ? match[1] : null;
}

/**
 * Sets a single <VALUE name="..." val="..."/> property in a JUCE XML string.
 * Returns { xml, changed } where changed is true only if the value actually differed.
 */
export function setJuceProp(xml, name, newVal) {
  const strVal = String(newVal);
  const re = new RegExp(`(<VALUE\\s+name="${escapeRegex(name)}"\\s+val=")([^"]*)("\\s*/>)`);
  const match = xml.match(re);

  if (match) {
    if (match[2] === strVal) {
      return { xml, changed: false };
    }
    const updated = xml.replace(re, `$1${strVal}$3`);
    return { xml: updated, changed: true };
  }

  // If the property doesn't exist yet in the <PROPERTIES> block, insert it before </PROPERTIES>
  const eol = xml.includes('\r\n') ? '\r\n' : '\n';
  const closeIdx = xml.lastIndexOf('</PROPERTIES>');
  if (closeIdx !== -1) {
    const line = `  <VALUE name="${name}" val="${strVal}"/>${eol}`;
    const updated = xml.slice(0, closeIdx) + line + xml.slice(closeIdx);
    return { xml: updated, changed: true };
  }

  throw new Error(`Invalid JUCE XML: missing </PROPERTIES> tag while setting ${name}`);
}

/**
 * Reads both preload and buffer from a JUCE .settings XML string.
 */
export function getPreloadAndBuffer(xml) {
  return {
    preload: getJuceProp(xml, PROP_PRELOAD),
    buffer: getJuceProp(xml, PROP_BUFFER),
  };
}

/**
 * Updates preload and/or buffer in a JUCE .settings XML string.
 * Returns { xml, changed, oldPreload, oldBuffer }.
 */
export function setPreloadAndBuffer(xml, preload, buffer) {
  const oldPreload = getJuceProp(xml, PROP_PRELOAD);
  const oldBuffer = getJuceProp(xml, PROP_BUFFER);

  const r1 = setJuceProp(xml, PROP_PRELOAD, preload);
  const r2 = setJuceProp(r1.xml, PROP_BUFFER, buffer);

  return {
    xml: r2.xml,
    changed: r1.changed || r2.changed,
    oldPreload,
    oldBuffer,
  };
}
