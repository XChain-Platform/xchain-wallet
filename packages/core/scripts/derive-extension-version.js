// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// Maps a wallet semver string to a Chrome-Web-Store-compatible
// `manifest.json` version. Chrome requires 1–4 dot-separated integers,
// each 0–65535 — prerelease suffixes like `-rc.1` are not allowed. We
// mirror the wallet's semver into `manifest.version_name` (free-form,
// human-readable) and derive a monotonic integer tuple for `version`
// (what Chrome actually uses for upgrade ordering).
//
// Rule (chosen to keep `version` monotonic across the RC → GA cut):
//
//     wallet M.m.p           →  M.m.p           (stable, 3 segments)
//     wallet M.m.p-rc.N      →  0.M.m.N         (prerelease, 4 segments)
//
// Properties:
//  - For any `M.m.p-rc.N` with M ≥ 1, `0.M.m.N` < `M.m.p`: Chrome
//    compares segment-by-segment, and the leading `0` pins prerelease
//    tuples strictly below every stable tuple with M ≥ 1.
//  - Successive RCs increase (0.1.0.1 < 0.1.0.2 < … < 0.1.0.N).
//  - N fits in one segment up to 65535 RC candidates — plenty.
//
// Usage:
//   import { deriveExtensionVersion } from './derive-extension-version.js';
//   deriveExtensionVersion('1.0.0-rc.1');  // → '0.1.0.1'
//   deriveExtensionVersion('1.0.0');        // → '1.0.0'

const STABLE_RE = /^(\d+)\.(\d+)\.(\d+)$/;
const RC_RE = /^(\d+)\.(\d+)\.(\d+)-rc\.(\d+)$/;

const MAX_SEGMENT = 65535;

function assertSegment(n, label) {
    if (!Number.isInteger(n) || n < 0 || n > MAX_SEGMENT) {
        throw new Error(
            `deriveExtensionVersion: ${label} out of range (0–${MAX_SEGMENT}): ${n}`,
        );
    }
}

/**
 * Derive the Chrome-manifest `version` string from a wallet semver.
 *
 * @param {string} walletVersion  — e.g. '1.0.0-rc.1' or '1.0.0'
 * @returns {string}              — e.g. '0.1.0.1'  or '1.0.0'
 * @throws if the input doesn't match either supported shape.
 */
export function deriveExtensionVersion(walletVersion) {
    if (typeof walletVersion !== 'string' || walletVersion.length === 0) {
        throw new Error(
            `deriveExtensionVersion: expected non-empty string, got ${JSON.stringify(walletVersion)}`,
        );
    }
    const stable = STABLE_RE.exec(walletVersion);
    if (stable) {
        const [, M, m, p] = stable;
        const parts = [Number(M), Number(m), Number(p)];
        parts.forEach((n, i) => assertSegment(n, ['major', 'minor', 'patch'][i]));
        return parts.join('.');
    }
    const rc = RC_RE.exec(walletVersion);
    if (rc) {
        const [, M, m, , N] = rc;
        const parts = [0, Number(M), Number(m), Number(N)];
        assertSegment(parts[1], 'major');
        assertSegment(parts[2], 'minor');
        assertSegment(parts[3], 'rc-number');
        return parts.join('.');
    }
    throw new Error(
        `deriveExtensionVersion: unrecognized wallet version ${JSON.stringify(walletVersion)}; expected 'M.m.p' or 'M.m.p-rc.N'`,
    );
}
