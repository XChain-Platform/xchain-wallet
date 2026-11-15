// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const INVALID_SIGNATURE_STATUS = new Set([
    'REVKEYSIG', 'EXPKEYSIG', 'EXPSIG', 'BADSIG', 'ERRSIG',
]);

/**
 * Classify one detached signature from GnuPG's machine-readable status.
 * VALIDSIG proves only that the signature packet is cryptographically valid;
 * GOODSIG is withheld when the signing key is revoked or expired.
 *
 * @param {string} statusText
 * @param {string} fingerprint
 * @returns {'ok'|'bad'|'wrong-key'|'key-invalid'}
 */
export function classifyPinnedSignature(statusText, fingerprint) {
    if (typeof statusText !== 'string') return 'bad';
    const statuses = statusText.split(/\r?\n/)
        .map((line) => /^\[GNUPG:\] (\S+)(?:\s+(.*))?$/.exec(line))
        .filter(Boolean)
        .map((match) => ({ name: match[1], fields: (match[2] || '').trim().split(/\s+/) }));
    const valid = statuses.filter(({ name }) => name === 'VALIDSIG');
    const newSignatures = statuses.filter(({ name }) => name === 'NEWSIG');
    if (valid.length !== 1 || newSignatures.length > 1) return 'bad';

    const signing = String(valid[0].fields[0] || '').toUpperCase();
    const primary = String(valid[0].fields.at(-1) || '').toUpperCase();
    const want = String(fingerprint || '').replace(/\s+/g, '').toUpperCase();
    const fullMatch = (candidate) => /^[0-9A-F]{40}$/.test(candidate) && candidate === want;
    if (!fullMatch(signing) && !fullMatch(primary)) return 'wrong-key';

    if (statuses.some(({ name }) => INVALID_SIGNATURE_STATUS.has(name))) return 'key-invalid';
    const good = statuses.filter(({ name }) => name === 'GOODSIG');
    const goodsigMatches = good.some(({ fields }) => {
        const key = String(fields[0] || '').toUpperCase();
        return key === signing || (/^[0-9A-F]{16}$/.test(key) && signing.endsWith(key));
    });
    return goodsigMatches ? 'ok' : 'bad';
}

const USAGE = `Usage: node tools/release/gpg-signature-status.mjs --help

gpg-signature-status.mjs is a library with no command of its own.
cws-upload.mjs and feed-sweep.mjs import classifyPinnedSignature() from it
to judge GnuPG --status-fd output against the pinned release key: one
VALIDSIG from that key, a matching GOODSIG, and none of REVKEYSIG,
EXPKEYSIG, EXPSIG, BADSIG or ERRSIG. Verdicts: ok, bad, wrong-key,
key-invalid.
`;

// Resolved through realpath so a symlinked or spaced checkout still answers.
const invokedDirectly = (() => {
    if (!process.argv[1]) return false;
    try {
        return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
    } catch {
        return false;
    }
})();

if (invokedDirectly) {
    const args = process.argv.slice(2);
    if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) {
        process.stdout.write(USAGE);
        process.exit(0);
    }
    process.stderr.write(USAGE);
    process.exit(2);
}
