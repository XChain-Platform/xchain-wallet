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
// end and submitWithSignerRevealOpts pins the submit end; between them every
// surface turns the composed result into a PrebuiltPsbt. Hand-copied, that
// object drifted twice: first without the deferred outputs (value burned on the
// reveal), then without the envelope pair and compression report (a TAPROOT
// commit refused unsigned). So one helper builds it and this file pins both
// the helper's shape and that no surface builds it by hand.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prebuiltPsbtFromComposed } from '../../../packages/core/src/flows/prebuiltPsbtFromComposed.js';
import {
    assertCompleteEnvelope,
    isEnvelopePair,
} from '../../../packages/core/src/sdk/submitWithSigner.js';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
// The envelope is built by the RENDERER, so only the surfaces that build one are scanned.
const CORE_SRC = resolve(REPO, 'packages/core/src/shared');
const HELPER = resolve(REPO, 'packages/core/src/flows/prebuiltPsbtFromComposed.js');

// Markers of a hand-built PrebuiltPsbt: its psbtHex copied off a composed
// result, or the donation verdict only that object carries.
const HAND_BUILT = [/psbtHex:\s*[A-Za-z_$][\w$]*\.psbt\b/, /adsDonation:/];

const KEYS = [
    'psbtHex', 'encoding', 'actionString', 'version', 'deferredFeeOutput', 'deferredOutputs',
    'revealOpts', 'revealPsbt', 'envelope', 'adsDonation', 'compression',
];

function walk(dir) {
    const out = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) out.push(...walk(full));
        else if (/\.(js|jsx)$/.test(entry.name)) out.push(full);
    }
    return out;
}

/** Every line in `src` that looks like part of a hand-built PrebuiltPsbt. */
function handBuiltLines(src) {
    return src.split('\n')
        .map((line, i) => ({ line, n: i + 1 }))
        .filter(({ line }) => HAND_BUILT.some((re) => re.test(line)));
}

const TAPROOT_COMPOSED = {
    psbt: 'COMMIT', encoding: 'TAPROOT', actionString: 'LIST|0|x', version: 0,
    deferredFeeOutput: { address: 'fee', value: 1000 },
    deferredOutputs: [{ address: 'fee', value: 1000 }],
    revealOpts: { change: 'chg' },
    revealPsbt: 'REVEAL',
    envelope: {
        commitTxid: 'ab'.repeat(32), commitVout: 0, commitValue: 20000,
        commitAddress: 'bcrt1pcommit', tapleafHash: 'cd'.repeat(32),
    },
    compression: { compressed: true },
    adsPlan: { canSubmit: true },
};

describe('prebuiltPsbtFromComposed', () => {
    it('carries every field, the envelope pair included, so a TAPROOT commit is signable', () => {
        const out = prebuiltPsbtFromComposed(TAPROOT_COMPOSED);
        expect(Object.keys(out).sort()).toEqual([...KEYS].sort());
        expect(out).toMatchObject({
            psbtHex: 'COMMIT', encoding: 'TAPROOT', revealPsbt: 'REVEAL',
            envelope: TAPROOT_COMPOSED.envelope, compression: { compressed: true },
            deferredFeeOutput: TAPROOT_COMPOSED.deferredFeeOutput,
            deferredOutputs: TAPROOT_COMPOSED.deferredOutputs,
            revealOpts: { change: 'chg' }, adsDonation: { included: true },
        });
        expect(() => assertCompleteEnvelope(out, 'LIST')).not.toThrow();
    });

    it('leaves a legacy result a legacy PrebuiltPsbt', () => {
        const out = prebuiltPsbtFromComposed({ psbt: 'P', encoding: 'OP_RETURN', actionString: 'a', version: 0 });
        expect(out).toMatchObject({
            revealPsbt: null, envelope: null, compression: null, revealOpts: null,
            deferredFeeOutput: null, deferredOutputs: [], adsDonation: { included: false },
        });
        expect(isEnvelopePair(out)).toBe(false);
    });
});

describe('no surface builds a PrebuiltPsbt by hand', () => {
    it('recognises a hand-built one where it knows there is one', () => {
        // Guards the guard: markers that matched nothing would pass every file below.
        expect(handBuiltLines(readFileSync(HELPER, 'utf8')).length).toBeGreaterThanOrEqual(2);
    });

    it('finds the surfaces that must call the helper', () => {
        const callers = walk(CORE_SRC)
            .filter((f) => readFileSync(f, 'utf8').includes('prebuiltPsbtFromComposed('))
            .map((f) => relative(CORE_SRC, f));
        // The shared confirm hook, ResumeConfirm and the eight forms that confirm directly.
        expect(callers.length).toBeGreaterThanOrEqual(10);
    });

    it('finds no hand-built one anywhere under shared/', () => {
        const hits = walk(CORE_SRC).flatMap((f) => handBuiltLines(readFileSync(f, 'utf8'))
            .map(({ n, line }) => `${relative(CORE_SRC, f)}:${n}: ${line.trim()}`));
        expect(hits).toEqual([]);
    });
});
