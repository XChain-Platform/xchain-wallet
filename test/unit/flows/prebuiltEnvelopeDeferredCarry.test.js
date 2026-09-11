// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The FORM half of the reveal carry. composeRevealOptsCarry pins the compose
// end and submitWithSignerRevealOpts pins the submit end; between them sits a
// hand-copied object literal per form, and six of them were copied without
// the three money-carrying fields. submitWithSigner then resolved the deferred
// set to [] and emitted no customOutputs on the reveal, so the value the commit
// reserved was burned and the reveal's change fell back to the un-rotated
// spending address.
//
// Source-shape rather than behavioural on purpose: the defect is a literal
// that drifts on copy, so what needs pinning is every copy of it, not one
// form's runtime path.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
// The envelope is built by the RENDERER, so only the surfaces that build one
// are scanned. flows/composeActionForConfirm.js also names `composed.psbt`, as
// an argument to assertNoTamper, and that is not an envelope.
const CORE_SRC = resolve(REPO, 'packages/core/src/shared');

// The envelope literal always opens on `psbtHex: composed.psbt` and closes on
// the donation verdict, so the slice between them is exactly one envelope.
const OPEN = 'psbtHex: composed.psbt';
const CLOSE = 'adsDonation:';
const REQUIRED = ['deferredFeeOutput:', 'deferredOutputs:', 'revealOpts:'];

function walk(dir) {
    const out = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) out.push(...walk(full));
        else if (/\.(js|jsx)$/.test(entry.name)) out.push(full);
    }
    return out;
}

/** Every prebuilt-envelope literal in packages/core, as { file, body } slices. */
function envelopeLiterals() {
    const found = [];
    for (const file of walk(CORE_SRC)) {
        const src = readFileSync(file, 'utf8');
        let from = 0;
        for (;;) {
            const open = src.indexOf(OPEN, from);
            if (open === -1) break;
            const close = src.indexOf(CLOSE, open);
            found.push({
                file: relative(CORE_SRC, file),
                // An envelope with no donation verdict at all is a defect of the
                // same class, so the slice runs to the end rather than skipping.
                body: close === -1 ? src.slice(open) : src.slice(open, close),
            });
            from = open + OPEN.length;
        }
    }
    return found;
}

describe('every prebuilt-PSBT envelope carries the deferred reveal set', () => {

    it('finds the envelope literals it means to police', () => {
        const literals = envelopeLiterals();
        // Six migrated forms + Send + useActionConfirmFlow. A drop below this
        // means the scan stopped seeing them, not that the drift was fixed.
        expect(literals.length).toBeGreaterThanOrEqual(8);
    });

    it.each(envelopeLiterals().map((e) => [e.file, e.body]))(
        '%s forwards deferredFeeOutput, deferredOutputs and revealOpts',
        (file, body) => {
            const missing = REQUIRED.filter((k) => !body.includes(k));
            expect({ file, missing }).toEqual({ file, missing: [] });
        },
    );
});
