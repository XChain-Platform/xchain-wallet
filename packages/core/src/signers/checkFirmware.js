// Firmware status check — §18.4. Given a (vendor, model, version)
// triple, consult the bundled manifest and return a status verdict
// the UI can render directly.
//
// Status semantics:
//   - 'ok'          — at or above `recommended`. No banner.
//   - 'outdated'    — above `minimum` and below `recommended`, and
//                     not listed as known-vulnerable / unsupported.
//                     Soft banner: "Update recommended."
//   - 'vulnerable'  — version (or a matching prefix) in
//                     `knownVulnerable`. Strong banner with details.
//   - 'unsupported' — version (or matching prefix) in `unsupported`,
//                     OR below `minimum`. Wallet refuses to sign until
//                     firmware is updated.
//   - 'unknown'     — vendor or model not present in the manifest.
//                     Neutral banner instructing the user to verify
//                     manually; sign path still allowed.
//
// The manifest is bundled at build time. A future enhancement fetches
// it at runtime — see §18.4.
//
// Version comparison is dotted-decimal semver-ish: "1.12.1" < "2.0.0".
// Entries in `knownVulnerable` / `unsupported` may be:
//   - Exact match:   "1.11.2"
//   - Prefix (ends in "."): "1.11." matches "1.11.0", "1.11.2", "1.11.99"
//   - Major-only:    "1.x"  matches "1.0.0", "1.42.7"
//
// The helper doesn't decide how to render the verdict — it just
// returns a flat object (status, vendor, model, displayName,
// recommended, updateUrl, detail). The UI composes copy.

import { FIRMWARE_MANIFEST } from './firmware-manifest.js';

const manifest = FIRMWARE_MANIFEST;

/** @typedef {'ok' | 'outdated' | 'vulnerable' | 'unsupported' | 'unknown'} FirmwareStatus */

/**
 * @typedef {Object} FirmwareVerdict
 * @property {FirmwareStatus} status
 * @property {string} vendor
 * @property {string} model
 * @property {string | null} displayName
 * @property {string | null} minimum
 * @property {string | null} recommended
 * @property {string | null} updateUrl
 * @property {string | null} detail        vulnerability advisory or similar
 * @property {string | null} version       version queried, echoed back
 */

/**
 * @param {{ vendor: string, model: string, version: string }} input
 * @returns {FirmwareVerdict}
 */
export function checkFirmware({ vendor, model, version }) {
    const vendorEntry = manifest.vendors?.[vendor];
    if (!vendorEntry) {
        return unknown({ vendor, model, version, updateUrl: null });
    }
    const updateUrl = vendorEntry.updateUrl ?? null;
    const modelEntry = vendorEntry.models?.[model];
    if (!modelEntry) {
        return unknown({ vendor, model, version, updateUrl });
    }

    if (typeof version !== 'string' || version.length === 0) {
        return {
            status: 'unknown',
            vendor,
            model,
            displayName: modelEntry.displayName ?? null,
            minimum: modelEntry.minimum ?? null,
            recommended: modelEntry.recommended ?? null,
            updateUrl,
            detail: 'Firmware version not reported by device.',
            version: null,
        };
    }

    const unsupportedHit = findMatch(version, modelEntry.unsupported || []);
    if (unsupportedHit) {
        return verdict('unsupported', vendor, model, modelEntry, updateUrl, version,
            `Firmware ${version} is not supported by the wallet. Update to ${modelEntry.recommended} or newer.`);
    }
    const vulnerableHit = findMatch(version, modelEntry.knownVulnerable || []);
    if (vulnerableHit) {
        return verdict('vulnerable', vendor, model, modelEntry, updateUrl, version,
            `Firmware ${version} has a known vulnerability (${vulnerableHit}). Update immediately.`);
    }

    const min = modelEntry.minimum;
    if (min && compareVersions(version, min) < 0) {
        return verdict('unsupported', vendor, model, modelEntry, updateUrl, version,
            `Firmware ${version} is below the minimum supported version (${min}).`);
    }
    const rec = modelEntry.recommended;
    if (rec && compareVersions(version, rec) < 0) {
        return verdict('outdated', vendor, model, modelEntry, updateUrl, version,
            `Firmware ${version} works but an update to ${rec} is recommended.`);
    }

    return verdict('ok', vendor, model, modelEntry, updateUrl, version, null);
}

/**
 * Check whether a candidate version matches any entry in the list.
 * Returns the matching entry string or null. Entries: exact ("1.11.2"),
 * prefix ("1.11."), or major-x ("1.x").
 */
function findMatch(version, list) {
    for (const entry of list) {
        if (typeof entry !== 'string') continue;
        if (entry === version) return entry;
        if (entry.endsWith('.') && version.startsWith(entry)) return entry;
        if (entry.endsWith('.x')) {
            const prefix = entry.slice(0, -1);  // "1.x" → "1."
            if (version === prefix.slice(0, -1) || version.startsWith(prefix)) return entry;
        }
    }
    return null;
}

/**
 * Compare two dotted-decimal version strings. Returns -1, 0, or 1.
 * Missing numeric segments are treated as 0 ("1.12" === "1.12.0").
 * Non-numeric suffixes (e.g. "1.12.0-rc1") sort before their stable
 * counterparts.
 */
export function compareVersions(a, b) {
    const as = parseVersion(a);
    const bs = parseVersion(b);
    const max = Math.max(as.nums.length, bs.nums.length);
    for (let i = 0; i < max; i += 1) {
        const av = as.nums[i] ?? 0;
        const bv = bs.nums[i] ?? 0;
        if (av < bv) return -1;
        if (av > bv) return 1;
    }
    // Numbers equal. Pre-release (non-empty suffix) sorts before stable.
    if (as.pre && !bs.pre) return -1;
    if (!as.pre && bs.pre) return 1;
    if (as.pre && bs.pre) return as.pre.localeCompare(bs.pre);
    return 0;
}

function parseVersion(v) {
    const m = /^(\d+(?:\.\d+)*)(?:[-+](.*))?$/.exec(String(v));
    if (!m) return { nums: [], pre: String(v) };
    const nums = m[1].split('.').map((n) => Number(n));
    return { nums, pre: m[2] ?? '' };
}

function verdict(status, vendor, model, entry, updateUrl, version, detail) {
    return {
        status,
        vendor,
        model,
        displayName: entry.displayName ?? null,
        minimum: entry.minimum ?? null,
        recommended: entry.recommended ?? null,
        updateUrl,
        detail,
        version,
    };
}

function unknown({ vendor, model, version, updateUrl }) {
    return {
        status: 'unknown',
        vendor,
        model,
        displayName: null,
        minimum: null,
        recommended: null,
        updateUrl,
        detail: `No firmware manifest entry for ${vendor}/${model}. Verify with vendor.`,
        version: typeof version === 'string' && version.length ? version : null,
    };
}
