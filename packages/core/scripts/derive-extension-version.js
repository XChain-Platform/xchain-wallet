// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Maps a wallet semver string to a Chrome-Web-Store-compatible
// `manifest.json` version. Chrome requires 1–4 dot-separated integers,
// each 0–65535; prerelease suffixes like `-rc.1` are not allowed. We
// mirror the wallet's semver into `manifest.version_name` (free-form,
// human-readable) and derive a monotonic integer tuple for `version`
// (what Chrome actually uses for upgrade ordering).
//
// Rule (chosen to keep `version` monotonic across each release cut):
//
//     wallet M.m.p             →  M.m.p       (stable, 3 segments)
//     wallet M.m.p-{rc,beta}.N →  0.M.m.N     (prerelease, 4 segments)
//     wallet M.m.p-respin.N    →  M.m.p.N     (respin, 4 segments)
//
// Properties:
//  - Prereleases sort below their stable release for the wallet's supported
//    release trains, including the current 0.MINOR.PATCH train.
//  - A respin adds a positive fourth segment, so it sorts above stable.
//  - Successive candidates and respins increase with N.
//
// Usage:
//   import { deriveExtensionVersion } from './derive-extension-version.js';
//   deriveExtensionVersion('0.342.0-beta.1');   // → '0.0.342.1'
//   deriveExtensionVersion('0.341.4');          // → '0.341.4'
//   deriveExtensionVersion('0.341.4-respin.1'); // → '0.341.4.1'

const RELEASE_RE = /^(\d+)\.(\d+)\.(\d+)(?:-(rc|beta|respin)\.(\d+))?$/;

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
 * @param {string} walletVersion  e.g. '0.342.0-beta.1' or '0.341.4-respin.1'
 * @returns {string}              e.g. '0.0.342.1' or '0.341.4.1'
 * @throws if the input doesn't match a supported release shape.
 */
export function deriveExtensionVersion(walletVersion) {
    if (typeof walletVersion !== 'string' || walletVersion.length === 0) {
        throw new Error(
            `deriveExtensionVersion: expected non-empty string, got ${JSON.stringify(walletVersion)}`,
        );
    }
    const release = RELEASE_RE.exec(walletVersion);
    if (!release) {
        throw new Error(
            `deriveExtensionVersion: unrecognized wallet version ${JSON.stringify(walletVersion)}; `
            + "expected 'M.m.p', 'M.m.p-rc.N', 'M.m.p-beta.N' or 'M.m.p-respin.N'",
        );
    }

    const [, M, m, p, lane, N] = release;
    const base = [Number(M), Number(m), Number(p)];
    base.forEach((n, i) => assertSegment(n, ['major', 'minor', 'patch'][i]));
    if (!lane) return base.join('.');

    const laneNumber = Number(N);
    assertSegment(laneNumber, `${lane}-number`);
    if (laneNumber === 0) {
        throw new Error(`deriveExtensionVersion: ${lane}-number must be at least 1`);
    }
    if (lane === 'respin') return [...base, laneNumber].join('.');

    return [0, base[0], base[1], laneNumber].join('.');
}
