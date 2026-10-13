// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// §56.3 Pre-launch, user-initiated track, Step 1: Chrome Web Store
// manifest hardening. Static audit over `packages/extension/manifest.json`
// that catches the most common CWS rejection reasons before submission
// and keeps the manifest in sync with the wallet's synchronized version
// on every bump.
//
// Rules (each returns { rule, ok, detail }):
//
//   1. manifest-version-3            - `manifest_version` must be 3
//   2. version-is-cws-valid          - 1–4 dot-separated integers, 0–65535
//   3. version-matches-wallet        - equals deriveExtensionVersion(root)
//   4. version-name-mirrors-wallet   - `version_name` === root package.json
//   5. extension-pkg-matches-wallet  - extension package version matches root
//   6. description-present-and-short - ≤ 132 chars (CWS listing limit)
//   7. homepage-url-set              - listing requires a homepage
//   8. icons-all-sizes-declared      - every generated icon is declared
//   9. icon-source-covers-sizes      - source PNG exists and is large enough
//  10. action-icon-set               - toolbar icons match extension icons
//  11. background-service-worker-mv3 - background uses a module service worker
//  12. csp-mv3-safe                  - CSP has no executable-string tokens
//  13. content-scripts-valid         - matches array well-formed
//  14. permissions-minimal           - no broad/host permissions without
//                                      justification file
//  15. permissions-frozen            - manifest.permissions equals the
//                                      pinned allowlist (§6)
//  16. host-permissions-frozen       - manifest.host_permissions equals
//                                      the pinned allowlist
//  17. content-script-matches-frozen - the (single) content_scripts
//                                      entry's matches equals the pinned
//                                      allowlist
//  18. war-matches-match-content-script - every web_accessible_resources
//                                      entry's matches equals the manifest's
//                                      OWN content_scripts matches (spec
//                                      §3.5: all three lists stay identical)
//
// Rule 14 treats host_permissions as the dangerous surface; matching-all
// (`<all_urls>`, `*://*/*`) without a recorded justification is flagged.
// Content-script `matches` inherit wallet-bridge scope (§51) and are
// considered justified.
//
// Rules 15-18 are the manifest-freeze gate (§6, stage S4). 15-17
// compare against packages/extension/docs/manifest-freeze.json, a pinned
// allowlist checked into the same repo: any drift in permissions,
// host_permissions, or content-script matches fails CI. Rule 18 does NOT
// compare against a second frozen copy of the match list; it checks the
// web_accessible_resources matches against manifest.json's own
// content_scripts matches, so the two cannot drift apart from each other
// even if they drifted together away from the allowlist. Comparison is by
// sorted-set equality (order-independent, value-exact): reordering a
// matches array is not a security-relevant change, an added/removed/altered
// pattern is. See manifest-freeze.json's own header for the gate's scope
// limits (it stops accidents, not a determined compromise; the release
// checklist's human diff step covers the rest).
//
// Usage:
//   node packages/core/scripts/extension-manifest-audit.js
//
// Exits 0 with a per-rule summary when every rule passes; non-zero with
// a failure report otherwise.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    EXTENSION_ICON_SIZES,
    EXTENSION_ICON_SOURCE,
    extensionIconPath,
} from '../../extension/iconConfig.js';
import { deriveExtensionVersion } from './derive-extension-version.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');
const manifestPath = join(repoRoot, 'packages/extension/manifest.json');
const rootPkgPath = join(repoRoot, 'package.json');
const extensionPkgPath = join(repoRoot, 'packages/extension/package.json');
const manifestFreezePath = join(repoRoot, 'packages/extension/docs/manifest-freeze.json');

function readJSON(path) {
    return JSON.parse(readFileSync(path, 'utf8'));
}

// Order-independent, value-exact array equality. A matches array is a set
// of patterns as far as Chrome is concerned; sorting before compare means
// a harmless reorder does not trip the freeze gate while an added, removed,
// or altered pattern always does.
function sameSet(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    const sa = [...a].sort();
    const sb = [...b].sort();
    return sa.every((v, i) => v === sb[i]);
}

function isCwsVersion(v) {
    if (typeof v !== 'string') return false;
    const parts = v.split('.');
    if (parts.length < 1 || parts.length > 4) return false;
    return parts.every((s) => /^\d+$/.test(s) && Number(s) >= 0 && Number(s) <= 65535);
}

function pngDimensions(path) {
    if (!existsSync(path)) return null;
    const png = readFileSync(path);
    const signature = '89504e470d0a1a0a';
    if (png.length < 24 || png.subarray(0, 8).toString('hex') !== signature) return null;
    return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

/**
 * Run every rule and return a list of results.
 * @returns {{ rule: string, ok: boolean, detail: string }[]}
 */
export function runExtensionManifestAudit(options = {}) {
    const manifest = options.manifest ?? readJSON(manifestPath);
    const rootPkg = readJSON(rootPkgPath);
    const extPkg = readJSON(extensionPkgPath);
    const walletVersion = rootPkg.version;
    const expectedVersion = deriveExtensionVersion(walletVersion);

    const results = [];

    results.push({
        rule: 'manifest-version-3',
        ok: manifest.manifest_version === 3,
        detail: `manifest.manifest_version = ${JSON.stringify(manifest.manifest_version)}`,
    });

    results.push({
        rule: 'version-is-cws-valid',
        ok: isCwsVersion(manifest.version),
        detail: `manifest.version = ${JSON.stringify(manifest.version)} (CWS requires 1–4 dot-separated integers 0–65535)`,
    });

    results.push({
        rule: 'version-matches-wallet',
        ok: manifest.version === expectedVersion,
        detail: `manifest.version = ${JSON.stringify(manifest.version)}, derived-from-root = ${JSON.stringify(expectedVersion)} (wallet ${walletVersion})`,
    });

    results.push({
        rule: 'version-name-mirrors-wallet',
        ok: manifest.version_name === walletVersion,
        detail: `manifest.version_name = ${JSON.stringify(manifest.version_name)}, wallet root.version = ${JSON.stringify(walletVersion)}`,
    });

    results.push({
        rule: 'extension-pkg-matches-wallet',
        ok: extPkg.version === walletVersion,
        detail: `packages/extension/package.json version = ${JSON.stringify(extPkg.version)}, wallet root.version = ${JSON.stringify(walletVersion)}`,
    });

    const desc = manifest.description;
    results.push({
        rule: 'description-present-and-short',
        ok: typeof desc === 'string' && desc.length > 0 && desc.length <= 132,
        detail: typeof desc === 'string'
            ? `manifest.description length = ${desc.length} (limit 132)`
            : `manifest.description missing`,
    });

    results.push({
        rule: 'homepage-url-set',
        ok: typeof manifest.homepage_url === 'string' && /^https?:\/\//.test(manifest.homepage_url),
        detail: `manifest.homepage_url = ${JSON.stringify(manifest.homepage_url)}`,
    });

    const expectedIconPaths = Object.fromEntries(
        EXTENSION_ICON_SIZES.map((size) => [String(size), extensionIconPath(size)]),
    );
    const icons = manifest.icons || {};
    results.push({
        rule: 'icons-all-sizes-declared',
        ok: JSON.stringify(icons) === JSON.stringify(expectedIconPaths),
        detail: `manifest.icons = ${JSON.stringify(icons)}, generated icons = ${JSON.stringify(expectedIconPaths)}`,
    });

    const iconSourcePath = join(repoRoot, 'packages/extension', EXTENSION_ICON_SOURCE);
    const iconDimensions = pngDimensions(iconSourcePath);
    const largestIcon = Math.max(...EXTENSION_ICON_SIZES);
    results.push({
        rule: 'icon-source-covers-sizes',
        ok: iconDimensions !== null
            && iconDimensions.width >= largestIcon
            && iconDimensions.height >= largestIcon,
        detail: `${iconSourcePath} dimensions = ${iconDimensions ? `${iconDimensions.width}x${iconDimensions.height}` : 'missing or invalid PNG'}, largest generated icon = ${largestIcon}x${largestIcon}`,
    });

    const actionIcon = manifest.action?.default_icon;
    results.push({
        rule: 'action-icon-set',
        ok: JSON.stringify(actionIcon) === JSON.stringify(expectedIconPaths),
        detail: `manifest.action.default_icon = ${JSON.stringify(actionIcon)}, expected = ${JSON.stringify(expectedIconPaths)}`,
    });

    const background = manifest.background || {};
    results.push({
        rule: 'background-service-worker-mv3',
        ok: typeof background.service_worker === 'string'
            && background.service_worker.length > 0
            && background.type === 'module'
            && !('scripts' in background)
            && !('page' in background)
            && !('persistent' in background),
        detail: `manifest.background = ${JSON.stringify(background)}`,
    });

    const extensionCsp = manifest.content_security_policy?.extension_pages;
    const unsafeCspTokens = typeof extensionCsp === 'string'
        ? extensionCsp.match(/'(?:unsafe-eval|wasm-unsafe-eval)'/g) || []
        : [];
    results.push({
        rule: 'csp-mv3-safe',
        ok: typeof extensionCsp === 'string'
            && extensionCsp.length > 0
            && unsafeCspTokens.length === 0,
        detail: typeof extensionCsp === 'string'
            ? `unsafe executable-string CSP tokens = ${JSON.stringify(unsafeCspTokens)}`
            : 'manifest.content_security_policy.extension_pages is missing',
    });

    const cs = manifest.content_scripts;
    let csOk = Array.isArray(cs) && cs.length > 0;
    if (csOk) {
        for (const entry of cs) {
            if (!Array.isArray(entry.matches) || entry.matches.length === 0) {
                csOk = false;
                break;
            }
            if (!Array.isArray(entry.js) || entry.js.length === 0) {
                csOk = false;
                break;
            }
        }
    }
    results.push({
        rule: 'content-scripts-valid',
        ok: csOk,
        detail: `content_scripts entries = ${Array.isArray(cs) ? cs.length : 'n/a'}`,
    });

    const hostPerms = manifest.host_permissions || [];
    const broad = hostPerms.filter((p) => p === '<all_urls>' || /^\*:\/\/\*\/\*$/.test(p));
    results.push({
        rule: 'permissions-minimal',
        ok: broad.length === 0,
        detail: broad.length === 0
            ? `host_permissions = ${JSON.stringify(hostPerms)} (no match-all entries)`
            : `broad host_permissions flagged: ${JSON.stringify(broad)} (document justification before reinstating)`,
    });

    // --- Manifest-freeze gate (§6) -------------------------------
    const freeze = readJSON(manifestFreezePath);
    const manifestPerms = manifest.permissions || [];
    const manifestHostPerms = manifest.host_permissions || [];

    results.push({
        rule: 'permissions-frozen',
        ok: sameSet(manifestPerms, freeze.permissions),
        detail: `manifest.permissions = ${JSON.stringify(manifestPerms)}, frozen allowlist = ${JSON.stringify(freeze.permissions)} (packages/extension/docs/manifest-freeze.json)`,
    });

    results.push({
        rule: 'host-permissions-frozen',
        ok: sameSet(manifestHostPerms, freeze.host_permissions),
        detail: `manifest.host_permissions = ${JSON.stringify(manifestHostPerms)}, frozen allowlist = ${JSON.stringify(freeze.host_permissions)} (packages/extension/docs/manifest-freeze.json)`,
    });

    const csEntries = Array.isArray(manifest.content_scripts) ? manifest.content_scripts : [];
    const csMatches = csEntries.length === 1 ? (csEntries[0].matches || []) : null;
    const csMatchesFrozenOk = csEntries.length === 1 && sameSet(csMatches, freeze.content_script_matches);
    results.push({
        rule: 'content-script-matches-frozen',
        ok: csMatchesFrozenOk,
        detail: csEntries.length !== 1
            ? `content_scripts has ${csEntries.length} entr(y/ies); the freeze gate expects exactly 1`
            : `content_scripts[0].matches = ${JSON.stringify(csMatches)}, frozen allowlist = ${JSON.stringify(freeze.content_script_matches)} (packages/extension/docs/manifest-freeze.json)`,
    });

    // Relational, not a second frozen copy: every web_accessible_resources
    // entry's matches must equal the manifest's OWN content_scripts matches
    // (spec §3.5), so the three lists cannot drift apart from each other
    // even independently of the allowlist above.
    const warEntries = Array.isArray(manifest.web_accessible_resources) ? manifest.web_accessible_resources : [];
    let warOk = csMatches !== null && warEntries.length > 0;
    const warDetails = [];
    if (warOk) {
        for (const entry of warEntries) {
            const entryOk = sameSet(entry.matches, csMatches);
            warDetails.push(`${JSON.stringify(entry.resources)} -> matches ${JSON.stringify(entry.matches)}${entryOk ? '' : ' (MISMATCH)'}`);
            if (!entryOk) warOk = false;
        }
    }
    results.push({
        rule: 'war-matches-match-content-script',
        ok: warOk,
        detail: warEntries.length === 0
            ? 'manifest.web_accessible_resources has no entries'
            : `content_scripts[0].matches = ${JSON.stringify(csMatches)}; web_accessible_resources: ${warDetails.join('; ')}`,
    });

    return results;
}

// Run as a script when invoked directly.
if (import.meta.url === `file://${process.argv[1]}`) {
    const results = runExtensionManifestAudit();
    const failed = results.filter((r) => !r.ok);
    for (const r of results) {
        const mark = r.ok ? '✓' : '✗';
        console.log(`${mark} ${r.rule}: ${r.detail}`);
    }
    console.log('');
    if (failed.length > 0) {
        console.error(`extension-manifest-audit: ${failed.length} / ${results.length} rule(s) failed`);
        process.exit(1);
    }
    console.log(`extension-manifest-audit: ${results.length} rules pass`);
}
