// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// §56.3 Pre-launch, user-initiated track, Step 1 — Chrome Web Store
// manifest hardening. Static audit over `packages/extension/manifest.json`
// that catches the most common CWS rejection reasons before submission
// and keeps the manifest in sync with the wallet's synchronized version
// on every bump.
//
// Rules (each returns { rule, ok, detail }):
//
//   1. manifest-version-3            — `manifest_version` must be 3
//   2. version-is-cws-valid          — 1–4 dot-separated integers, 0–65535
//   3. version-matches-wallet        — equals deriveExtensionVersion(root)
//   4. version-name-mirrors-wallet   — `version_name` === root package.json
//   5. description-present-and-short — ≤ 132 chars (CWS listing limit)
//   6. homepage-url-set              — listing requires a homepage
//   7. icons-128-present             — CWS store tile requires 128×128
//   8. action-icon-set               — toolbar icon entry points valid
//   9. content-scripts-valid         — matches array well-formed
//  10. permissions-minimal           — no broad/host permissions without
//                                      justification file
//
// Rule 10 treats host_permissions as the dangerous surface; matching-all
// (`<all_urls>`, `*://*/*`) without a recorded justification is flagged.
// Content-script `matches` inherit wallet-bridge scope (§51) and are
// considered justified.
//
// Usage:
//   node packages/core/scripts/extension-manifest-audit.js
//
// Exits 0 with a per-rule summary when every rule passes; non-zero with
// a failure report otherwise.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveExtensionVersion } from './derive-extension-version.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');
const manifestPath = join(repoRoot, 'packages/extension/manifest.json');
const rootPkgPath = join(repoRoot, 'package.json');
const extensionPkgPath = join(repoRoot, 'packages/extension/package.json');

function readJSON(path) {
    return JSON.parse(readFileSync(path, 'utf8'));
}

function isCwsVersion(v) {
    if (typeof v !== 'string') return false;
    const parts = v.split('.');
    if (parts.length < 1 || parts.length > 4) return false;
    return parts.every((s) => /^\d+$/.test(s) && Number(s) >= 0 && Number(s) <= 65535);
}

/**
 * Run every rule and return a list of results.
 * @returns {{ rule: string, ok: boolean, detail: string }[]}
 */
export function runExtensionManifestAudit() {
    const manifest = readJSON(manifestPath);
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

    const icons = manifest.icons || {};
    results.push({
        rule: 'icons-128-present',
        ok: typeof icons['128'] === 'string' && icons['128'].length > 0,
        detail: `manifest.icons['128'] = ${JSON.stringify(icons['128'])}`,
    });

    const actionIcon = manifest.action?.default_icon;
    results.push({
        rule: 'action-icon-set',
        ok: actionIcon && typeof actionIcon === 'object' && typeof actionIcon['128'] === 'string',
        detail: `manifest.action.default_icon['128'] = ${JSON.stringify(actionIcon?.['128'])}`,
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
            : `broad host_permissions flagged: ${JSON.stringify(broad)} — document justification before reinstating`,
    });

    return results;
}

// Run as a script when invoked directly.
if (import.meta.url === `file://${process.argv[1]}`) {
    const results = runExtensionManifestAudit();
    const failed = results.filter((r) => !r.ok);
    for (const r of results) {
        const mark = r.ok ? '✓' : '✗';
        console.log(`${mark} ${r.rule} — ${r.detail}`);
    }
    console.log('');
    if (failed.length > 0) {
        console.error(`extension-manifest-audit: ${failed.length} / ${results.length} rule(s) failed`);
        process.exit(1);
    }
    console.log(`extension-manifest-audit: ${results.length} rules pass`);
}
