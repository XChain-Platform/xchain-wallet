// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// DeployContractForm rendered SDK validate / plan / metering strings
// verbatim. The translator rewrites only the ones naming an internal the author
// cannot act on, and PASSES the rest of lint-core's advisories through untouched
// - those already carry the line, the symbol and the fix, so translating them
// would delete the actionable part.
//
// The two exceptions are the warning-severity advisories that state their
// consequence as "the gas ceiling": unbounded-loop and large-allocation. They
// are rewritten because `warnings` is the ONLY diagnostic array the form renders
// on the res.valid === true branch, which is the surface #4374 is anchored on,
// and because the finding names that phrase among the strings to translate.
// An earlier pass listed both among the pass-throughs below; that assertion was
// authored alongside the code it certified, and it left the finding's own anchor
// line rendering byte-identical to pre-fix output.
//
// The raw strings below are copied from the emitting expressions:
//   xchain-sdk/src/chunkHelper.js:95           (MAX_DEPLOY_CHUNKS overflow)
//   xchain-sdk/src/contract/lint-core.js       (code-size, unsupported-syntax,
//                                               reserved-identifier, banned-wasm,
//                                               and the pass-through advisories)
//   xchain-sdk/src/contracts.js:222            (suggestGasLimit rationale)

import { describe, it, expect } from 'vitest';
import {
    humanizeDeployDiagnostic,
    humanizeGasRationale,
} from '../../../../packages/core/src/shared/utils/deployDiagnostic.js';

describe('humanizeDeployDiagnostic', () => {
    it('restates the MAX_DEPLOY_CHUNKS overflow without naming the constant', () => {
        const raw = 'Contract source needs 21 chunks, exceeds MAX_DEPLOY_CHUNKS (16)';
        const out = humanizeDeployDiagnostic(new Error(raw));
        expect(out.matched).toBe(true);
        expect(out.rule).toBe('deploy-chunk-overflow');
        expect(out.message).not.toMatch(/MAX_DEPLOY_CHUNKS/);
        // Lossless: both counts survive the rewrite.
        expect(out.message).toMatch(/21/);
        expect(out.message).toMatch(/16/);
    });

    it('restates the code-size cap that validate() actually emits', () => {
        // contracts.js validate() returns on its own size guard BEFORE
        // lintSource runs, so this - not lint-core's 'code size exceeds
        // limit (N bytes)' - is what the wallet can receive.
        const out = humanizeDeployDiagnostic('Contract code exceeds 65536 byte limit (70039 bytes)');
        expect(out.rule).toBe('code-size');
        expect(out.message).toMatch(/70039 bytes/);
        expect(out.message).toMatch(/65536-byte deploy limit/);
    });

    it('also covers the lint-core code-size wording if that order ever reverses', () => {
        const out = humanizeDeployDiagnostic('code size exceeds limit (65536 bytes)');
        expect(out.rule).toBe('code-size');
        expect(out.message).toMatch(/65536-byte deploy limit/);
    });

    it('restates the ES-version rejection and keeps the parser detail', () => {
        const out = humanizeDeployDiagnostic(
            'unsupported syntax (ES2020 maximum): Unexpected token (3:9)');
        expect(out.rule).toBe('unsupported-syntax');
        expect(out.message).toMatch(/ES2020 JavaScript or older/);
        expect(out.message).toMatch(/Unexpected token \(3:9\)/);
    });

    it('keeps the reserved identifier itself, since that is the fix', () => {
        const out = humanizeDeployDiagnostic('reserved identifier: __gas');
        expect(out.rule).toBe('reserved-identifier');
        expect(out.message).toContain('__gas');
        expect(out.message).toMatch(/Rename it/);
        // The bare SDK phrasing must not survive.
        expect(out.message).not.toMatch(/^reserved identifier/);
    });

    it('restates the WebAssembly ban without __gas or consensus vocabulary', () => {
        const raw = 'banned global: WebAssembly at line 12; WebAssembly executes native code '
            + 'that carries no __gas metering (unmetered native execution) and is a '
            + 'consensus-fork surface. The sandbox removes it, so this is unreachable at runtime';
        const out = humanizeDeployDiagnostic(raw);
        expect(out.rule).toBe('banned-wasm');
        expect(out.message).not.toMatch(/__gas|unmetered native execution|consensus-fork/);
        expect(out.message).toMatch(/line 12/);
    });

    it('passes lint-core advisories through untouched', () => {
        // Each already names the line, the symbol and the prescribed fix.
        const passthrough = [
            "state.get(...) result dereferenced at line 40 without a null guard; an absent key returns null and will throw. Default it (e.g. `|| '0'`) or require() it first",
            'banned API: Math.sin at line 7; IEEE 754 floating-point transcendentals are non-deterministic across CPU architectures. Use xchain.math.sin() instead',
            'method "transfer" at line 12 reads input params but has no require() validation; validate inputs before use',
            'WARNING: decimal number literal (0.5) detected at line 9; use xchain.math for deterministic arithmetic',
        ];
        for (const raw of passthrough) {
            const out = humanizeDeployDiagnostic(raw);
            expect(out.matched).toBe(false);
            expect(out.message).toBe(raw);
        }
    });

    it('restates the unbounded-loop advisory without naming the gas ceiling, keeping the line', () => {
        const raw = 'unbounded loop at line 30; termination depends entirely on an internal break '
            + '(the gas ceiling will halt it otherwise)';
        const out = humanizeDeployDiagnostic(raw);
        expect(out.rule).toBe('unbounded-loop');
        expect(out.message).not.toMatch(/gas ceiling/);
        expect(out.message).toMatch(/line 30/);
        expect(out.message).toMatch(/runs out of gas/);
    });

    it('restates the large-allocation advisory, keeping the line and the allocation kind', () => {
        const raw = 'bulk allocation (Uint8Array) at line 20; gas-metered at runtime, keep the size '
            + 'bounded so it cannot hit the gas ceiling';
        const out = humanizeDeployDiagnostic(raw);
        expect(out.rule).toBe('large-allocation');
        expect(out.message).not.toMatch(/gas ceiling|gas-metered/);
        expect(out.message).toMatch(/line 20/);
        expect(out.message).toMatch(/Uint8Array/);
    });

    it('returns unrecognized text unchanged so a rephrasing degrades, not mistranslates', () => {
        const out = humanizeDeployDiagnostic('some future SDK wording nobody mapped');
        expect(out.matched).toBe(false);
        expect(out.message).toBe('some future SDK wording nobody mapped');
    });

    it('reports empty for absent input so callers can fall back', () => {
        expect(humanizeDeployDiagnostic(undefined).message).toBe('');
        expect(humanizeDeployDiagnostic(null).message).toBe('');
        expect(humanizeDeployDiagnostic(new Error('')).message).toBe('');
    });
});

describe('humanizeGasRationale', () => {
    it('restates the count dump in plain language, keeping every count', () => {
        const raw = '1240 bytes, 3 functions, 2 loops (1 indexed for, charged 2x/iteration), '
            + '4 emit calls, 6 state ops';
        const out = humanizeGasRationale(raw);
        expect(out).not.toMatch(/2x\/iteration|indexed for|emit calls|state ops/);
        expect(out).toBe('estimated from 1240 bytes of code: 3 functions, 2 loops, '
            + '4 event emits, 6 state writes, and 1 counted for-loop that cost double per pass');
    });

    it('drops the doubling clause when there is no counted for-loop', () => {
        const out = humanizeGasRationale(
            '80 bytes, 1 functions, 0 loops (0 indexed for, charged 2x/iteration), 0 emit calls, 1 state ops');
        expect(out).toBe('estimated from 80 bytes of code: 1 function, 0 loops, '
            + '0 event emits, 1 state write');
    });

    it('returns null on an unrecognized shape so the caller keeps the raw string', () => {
        expect(humanizeGasRationale('1240 bytes and some new phrasing')).toBe(null);
        expect(humanizeGasRationale(null)).toBe(null);
        expect(humanizeGasRationale('')).toBe(null);
    });
});
