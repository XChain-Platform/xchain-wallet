// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The run record reader: flattening nested suites, the verdict lines and exit
// codes, with an injected readFile and fake streams so nothing touches disk.

import { describe, it, expect } from 'vitest';
import { summarizeRun, main } from '../../e2e/fixtures/testnet_evidence.js';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const C = 'c'.repeat(64);

const tx = (description) => ({ type: 'txid', description });
const mk = (title, status, annotations = [], results = []) => ({
    title,
    file: 'staking/x.testnet.spec.js',
    tests: [{ status, annotations, results }],
});

function report(specs, errors = []) {
    return { errors, suites: [{ file: 'outer', specs: [], suites: [{ file: 'inner', specs }] }] };
}

function run(json, argv = ['r.json']) {
    const out = [];
    const err = [];
    const readFile = async () => {
        if (json instanceof Error) throw json;
        return typeof json === 'string' ? json : JSON.stringify(json);
    };
    return main({
        argv,
        readFile,
        stdout: { write: (s) => out.push(s) },
        stderr: { write: (s) => err.push(s) },
    }).then((code) => ({ code, out, err }));
}

describe('summarizeRun', () => {
    it('walks nested suites in order and parses txids', () => {
        const r = report([
            mk('one', 'expected', [tx(`funding ${A}`)]),
            mk('two', 'expected', [tx(`stake ${B}`), tx(`collect ${C}`)]),
        ]);
        const s = summarizeRun(r);
        expect(s.errors).toBe(0);
        expect(s.tests.map((t) => t.title)).toEqual(['one', 'two']);
        expect(s.tests[1].txids).toEqual([
            { label: 'stake', txid: B },
            { label: 'collect', txid: C },
        ]);
    });

    it('reports a txid on both the test and its result once', () => {
        const r = report([mk('dup', 'expected', [tx(`stake ${A}`)], [{ annotations: [tx(`stake ${A}`), tx(`unstake ${B}`)] }])]);
        expect(summarizeRun(r).tests[0].txids).toEqual([
            { label: 'stake', txid: A },
            { label: 'unstake', txid: B },
        ]);
    });

    it('throws naming the file and title for a malformed annotation', () => {
        const r = report([mk('bad one', 'expected', [tx('stake nothex')])]);
        expect(() => summarizeRun(r)).toThrow(/staking\/x\.testnet\.spec\.js.*bad one/);
    });
});

describe('main', () => {
    it('passes a clean run', async () => {
        const { code, out } = await run(report([mk('ok', 'expected', [tx(`funding ${A}`)])]));
        expect(code).toBe(0);
        expect(out).toEqual([
            'expected staking/x.testnet.spec.js ok\n',
            `  funding ${A}\n`,
            'testnet run passed\n',
        ]);
    });

    it('fails on an unexpected test', async () => {
        const { code, out } = await run(report([mk('no', 'unexpected', [tx(`funding ${A}`)])]));
        expect(code).toBe(1);
        expect(out.at(-1)).toBe('testnet run failed\n');
    });

    it('fails on a skipped test', async () => {
        const { code, out } = await run(report([mk('skip', 'skipped', [tx(`funding ${A}`)])]));
        expect(code).toBe(1);
        expect(out.at(-1)).toBe('testnet run failed\n');
    });

    it('fails on run errors', async () => {
        const { code } = await run(report([mk('ok', 'expected', [tx(`funding ${A}`)])], [{ message: 'boom' }]));
        expect(code).toBe(1);
    });

    it('fails when the run holds no txid', async () => {
        const { code } = await run(report([mk('ok', 'expected')]));
        expect(code).toBe(1);
    });

    it('returns 2 naming the path when the file is missing', async () => {
        const { code, err } = await run(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }), ['gone.json']);
        expect(code).toBe(2);
        expect(err).toHaveLength(1);
        expect(err[0]).toContain('gone.json');
    });

    it('returns 2 when the file is not JSON', async () => {
        const { code, err } = await run('not json', ['bad.json']);
        expect(code).toBe(2);
        expect(err[0]).toContain('bad.json');
    });
});
