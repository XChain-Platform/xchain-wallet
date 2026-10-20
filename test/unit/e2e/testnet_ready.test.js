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

import { describe, expect, it, vi } from 'vitest';
import { main } from '../../e2e/fixtures/testnet_ready.js';

function output() {
    let text = '';
    return { stream: { write: (chunk) => { text += chunk; } }, text: () => text };
}

function streams({ isTTY = false } = {}) {
    const stdout = output();
    const stderr = output();
    return { stdin: { isTTY }, stdout: stdout.stream, stderr: stderr.stream, out: stdout, err: stderr };
}

describe('testnet ready', () => {
    it('runs setup once, tears down once and reports ready', async () => {
        const teardown = vi.fn(async () => {});
        const setup = vi.fn(async () => teardown);
        const io = streams();

        const code = await main({ setup, stdin: io.stdin, stdout: io.stdout, stderr: io.stderr });

        expect(code).toBe(0);
        expect(setup).toHaveBeenCalledTimes(1);
        expect(teardown).toHaveBeenCalledTimes(1);
        expect(io.out.text()).toBe('testnet run ready\n');
        expect(io.err.text()).toBe('');
    });

    it('reports a rejection on stderr with nothing on stdout and no teardown', async () => {
        const teardown = vi.fn();
        const setup = vi.fn(async () => { throw new Error('venue tip is stale'); });
        const io = streams();

        const code = await main({ setup, stdin: io.stdin, stdout: io.stdout, stderr: io.stderr });

        expect(code).toBe(1);
        expect(teardown).not.toHaveBeenCalled();
        expect(io.out.text()).toBe('');
        expect(io.err.text()).toBe('testnet run not ready: venue tip is stale\n');
    });

    it('refuses a terminal stdin without calling setup', async () => {
        const setup = vi.fn();
        const io = streams({ isTTY: true });

        const code = await main({ setup, stdin: io.stdin, stdout: io.stdout, stderr: io.stderr });

        expect(code).toBe(2);
        expect(setup).not.toHaveBeenCalled();
        expect(io.out.text()).toBe('');
        expect(io.err.text().trim().split('\n')).toHaveLength(1);
        expect(io.err.text()).toContain('testnet_run_input.js');
    });
});
