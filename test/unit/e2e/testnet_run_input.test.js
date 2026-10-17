// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// @vitest-environment node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseRunInput } from '../../e2e/fixtures/testnet.js';
import { assembleRunInput, main } from '../../e2e/fixtures/testnet_run_input.js';

const TREASURY = Object.freeze({
    wif: 'treasury-secret-wif',
    address: 'tb1qz2qzsfp5g3g2ez6k4z4x56vuzs3uh3hehhq469',
});
const CLAIMANT = Object.freeze({
    wif: 'claimant-secret-wif',
    address: 'mverify5szar1XwwAjqAnPUHbA814kfHh4',
});

const tempRoots = [];

function tempRoot() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xc-testnet-input-'));
    tempRoots.push(root);
    return root;
}

function writeWallet(root, name, wallet, mode = 0o600) {
    const file = path.join(root, name);
    fs.writeFileSync(file, JSON.stringify(wallet), { mode });
    fs.chmodSync(file, mode);
    return file;
}

function output({ isTTY = false } = {}) {
    let text = '';
    return {
        stream: { isTTY, write: (chunk) => { text += chunk; } },
        text: () => text,
    };
}

afterEach(() => {
    for (const root of tempRoots.splice(0)) {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

describe('testnet run input assembler', () => {
    it('normalizes both address aliases into input accepted by the harness', () => {
        const text = assembleRunInput(
            JSON.stringify({ wif: TREASURY.wif, segwitAddress: TREASURY.address }),
            JSON.stringify({ wif: CLAIMANT.wif, segwitAddress: CLAIMANT.address }),
        );

        expect(JSON.parse(text)).toEqual({
            ...TREASURY,
            claimant: CLAIMANT,
        });
        expect(parseRunInput(text)).toEqual({ ...TREASURY, claimant: CLAIMANT });
    });

    it.each([
        ['treasury', 'wif', {}, CLAIMANT],
        ['treasury', 'wif', { ...TREASURY, wif: 7 }, CLAIMANT],
        ['treasury', 'address', { wif: TREASURY.wif }, CLAIMANT],
        ['treasury', 'address', { ...TREASURY, address: 7 }, CLAIMANT],
        ['claimant', 'wif', TREASURY, {}],
        ['claimant', 'wif', TREASURY, { ...CLAIMANT, wif: 7 }],
        ['claimant', 'address', TREASURY, { wif: CLAIMANT.wif }],
        ['claimant', 'address', TREASURY, { ...CLAIMANT, address: 7 }],
    ])('refuses a missing or non-string %s %s without exposing either value',
        (role, field, treasury, claimant) => {
            let error;
            try {
                assembleRunInput(JSON.stringify(treasury), JSON.stringify(claimant));
            } catch (caught) {
                error = caught;
            }
            expect(error).toBeInstanceOf(Error);
            expect(error.message).toContain(role);
            expect(error.message).toContain(field);
            expect(error.message).not.toContain(TREASURY.wif);
            expect(error.message).not.toContain(CLAIMANT.wif);
        });

    it.each([
        ['treasury', { ...TREASURY, address: 'bc1q-mainnet-treasury' }, CLAIMANT],
        ['claimant', TREASURY, { ...CLAIMANT, address: '1-mainnet-claimant' }],
    ])('refuses a non-testnet %s address without exposing either value',
        (role, treasury, claimant) => {
            let error;
            try {
                assembleRunInput(JSON.stringify(treasury), JSON.stringify(claimant));
            } catch (caught) {
                error = caught;
            }
            expect(error).toBeInstanceOf(Error);
            expect(error.message).toContain(role);
            expect(error.message).toContain('address');
            expect(error.message).not.toContain(treasury.address);
            expect(error.message).not.toContain(claimant.address);
        });

    it.each(['treasury', 'claimant'])('names malformed %s JSON without echoing it', (role) => {
        const malformed = '{"wif":"do-not-echo"';
        const texts = role === 'treasury'
            ? [malformed, JSON.stringify(CLAIMANT)]
            : [JSON.stringify(TREASURY), malformed];
        expect(() => assembleRunInput(...texts)).toThrow(new RegExp(`${role} file`));
        try {
            assembleRunInput(...texts);
        } catch (error) {
            expect(error.message).not.toContain('do-not-echo');
        }
    });
});

describe('testnet run input command', () => {
    it('writes only the assembled object when both 0600 files are supplied', () => {
        const root = tempRoot();
        const treasury = writeWallet(root, 'treasury.json', TREASURY);
        const claimant = writeWallet(root, 'claimant.json', CLAIMANT);
        const stdout = output();
        const stderr = output();

        expect(main([treasury, claimant], { stdout: stdout.stream, stderr: stderr.stream })).toBe(0);
        expect(JSON.parse(stdout.text())).toEqual({ ...TREASURY, claimant: CLAIMANT });
        expect(stderr.text()).toBe('');
    });

    it.each([
        ['treasury', 0o640],
        ['treasury', 0o604],
        ['claimant', 0o640],
        ['claimant', 0o604],
    ])('refuses a %s file with mode %s before writing output', (role, mode) => {
        const root = tempRoot();
        const treasury = writeWallet(root, 'treasury.json', TREASURY, role === 'treasury' ? mode : 0o600);
        const claimant = writeWallet(root, 'claimant.json', CLAIMANT, role === 'claimant' ? mode : 0o600);
        const stdout = output();

        expect(() => main([treasury, claimant], { stdout: stdout.stream })).toThrow(new RegExp(`${role} file`));
        expect(stdout.text()).toBe('');
    });

    it('refuses a TTY before reading either file', () => {
        const stdout = output({ isTTY: true });
        expect(() => main(['/missing/treasury', '/missing/claimant'], { stdout: stdout.stream }))
            .toThrow(/stdout is a TTY/);
        expect(stdout.text()).toBe('');
    });

    it.each([
        { argv: [] },
        { argv: ['treasury.json'] },
    ])('returns 2 with one usage line when paths are missing', ({ argv }) => {
        const stdout = output();
        const stderr = output();
        expect(main(argv, { stdout: stdout.stream, stderr: stderr.stream })).toBe(2);
        expect(stdout.text()).toBe('');
        expect(stderr.text().trim().split('\n')).toHaveLength(1);
        expect(stderr.text()).toMatch(/^usage: .*<treasury\.json> <claimant\.json>\n$/);
    });
});
