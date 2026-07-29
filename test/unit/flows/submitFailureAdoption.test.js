// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

//  /  / §11.5: every authoring form turns a failed submit into a
// sentence through ONE helper, and every form that calls that helper imports it.
//
// Both halves were found by driving §11.5's native-fee lane against a payer who
// could not cover the fee (wallet E2E session 28):
//
//   D-121. Nine authoring surfaces still hand-rolled the mapping - they
//     translated NativeFeeForfeitError and passed everything else through as
//     `err.message`. So an encoder build failure reached the user as the wire
//     wording  exists to remove. Measured on the Issue form on Bitcoin
//     regtest: "Encoder RPC error: insufficient funds: selected inputs total
//     1000 but 3206 is required (outputs 2000 + fee 1206)". The facts are all
//     there; the sentence is not, and on other codes it is worse - a stale
//     utxo-tracker (a service fault) reads as the user's mistake.
//
//   D-122. DividendForm CALLED the helper on its sign path without importing
//     it. A bundler does not catch an undefined identifier, and the reference
//     sits inside a catch block, so it only fires when a submit fails - and
//     when it does it throws while building setSubmitError's argument, so
//     neither the message nor `setStage('review')` runs and the form is stuck
//     on "submitting" with nothing on screen.
//
// Both are structural, so they are pinned structurally rather than by driving
// one form: a form added next month gets the same answer on the day it is
// written. The roster is derived from the tree, never listed.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SHARED = join(HERE, '..', '..', '..', 'packages', 'core', 'src', 'shared');

function sharedSources() {
    const out = [];
    for (const dir of ['components', 'routes']) {
        for (const file of readdirSync(join(SHARED, dir))) {
            if (!file.endsWith('.jsx')) continue;
            const rel = `${dir}/${file}`;
            out.push({ rel, src: readFileSync(join(SHARED, rel), 'utf8') });
        }
    }
    return out;
}

const SOURCES = sharedSources();

// An identifier is imported when it appears inside an import statement's brace
// list. Deliberately not a full parse: these files use one import style, and a
// regex that only ever reads `import { ... } from '...'` cannot be fooled by a
// call site, which is the exact confusion D-122 was.
function importsIdentifier(src, name) {
    const imports = src.match(/import\s*\{[^}]*\}\s*from\s*'[^']*';/g) || [];
    return imports.some((stmt) => new RegExp(`\\b${name}\\b`).test(stmt));
}

describe(': one helper turns a failed submit into a sentence', () => {
    it('finds the shared surfaces (guards against an empty sweep)', () => {
        expect(SOURCES.length).toBeGreaterThan(50);
    });

    // D-122, generalized. Any identifier the file calls but never imports would
    // do this; this checks the one that was actually wrong, on every file, which
    // is what makes it a guard rather than a regression test for one form.
    for (const { rel, src } of SOURCES) {
        if (!/submitFailureMessage\s*\(/.test(src)) continue;
        it(`${rel} imports the helper it calls`, () => {
            expect(importsIdentifier(src, 'submitFailureMessage'),
                `${rel} calls submitFailureMessage without importing it. That is a ReferenceError `
                + 'thrown from inside a catch block, so the failure it was meant to explain leaves '
                + 'the form stuck with nothing on screen (D-122).')
                .toBe(true);
        });
    }

    // D-121. nativeFeeErrorMessage is the native-fee HALF of the mapping; a form
    // calling it directly is a form that maps nothing else, which is how encoder
    // wire wording reached users on nine surfaces.
    for (const { rel, src } of SOURCES) {
        if (!/nativeFeeErrorMessage\s*\(/.test(src)) continue;
        it(`${rel} maps failures through submitFailureMessage, not nativeFeeErrorMessage alone`, () => {
            expect(/submitFailureMessage\s*\(/.test(src),
                `${rel} calls nativeFeeErrorMessage directly. That maps the native-fee refusal and `
                + 'lets every other failure through as wire wording - the encoder\'s own developer '
                + 'strings , and a params-builder refusal (D-118). submitFailureMessage is '
                + 'the single place that decision belongs.')
                .toBe(true);
        });
    }
});
