// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// GET /contract/{idx}/state and GET /{COIN}/api/executions/{idx}/contract both
// return snake_case field names (state_key/state_value, method_name/action/
// status/gas_used) that never matched the mapper's key/value/method guesses,
// so the State table rendered blank keys and null values and every execution
// row read "(method)" with no way to tell a reverted call from a good one.

import { describe, it, expect } from 'vitest';
import { render, act as domAct } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ContractDetail } from '../../../packages/core/src/shared/routes/ContractDetail.jsx';

const CHAIN = 'bitcoin-mainnet';

function harness(overrides = {}) {
    const target = {
        getAddressesByChain: () => Promise.resolve({}),
        getActiveAddresses: () => Promise.resolve({}),
        getContractByActionIndex: () => Promise.resolve({
            data: { action_index: '49', status: 'valid' },
        }),
        getActionByIndex: () => Promise.resolve({}),
        getContractState: () => Promise.resolve({}),
        getContractBalance: () => Promise.resolve({}),
        getExecutionsForContract: () => Promise.resolve({ data: [] }),
    };
    Object.assign(target, overrides);
    const messaging = new Proxy(target, {
        get(t, prop) {
            if (prop in t) return t[prop];
            return () => Promise.resolve({});
        },
    });
    return { messaging };
}

async function drain(rounds = 16) {
    for (let i = 0; i < rounds; i += 1) await Promise.resolve();
}

function mount(messaging, props) {
    return render(
        React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(ContractDetail, { chainId: CHAIN, contractActionIndex: '49', onBack() {}, ...props }),
        ),
    );
}

function expandState(utils) {
    const btn = Array.from(utils.container.querySelectorAll('button'))
        .find((b) => /Expand/i.test(b.textContent || ''));
    expect(btn).toBeTruthy();
    btn.click();
}

describe('State table reads the explorer\'s real field names', () => {
    it('renders state_key/state_value rows, decoding a JSON-encoded scalar', async () => {
        const { messaging } = harness({
            getContractState: () => Promise.resolve({
                data: [
                    { state_key: 'pending', state_value: null },
                    { state_key: 'price', state_value: '"{\\n  \\"userId\\": 1\\n}"' },
                ],
                total: 2,
            }),
        });
        let utils;
        await domAct(async () => {
            utils = mount(messaging);
            await drain();
        });
        await domAct(async () => {
            expandState(utils);
            await drain();
        });
        expect(utils.container.textContent).toContain('pending');
        expect(utils.container.textContent).toContain('price');
        // pending is a real null value: still shows the literal word "null".
        expect(utils.container.textContent).toMatch(/pending[\s\S]*null/);
        // price was double-JSON-encoded: one parse strips the outer quotes and
        // escapes, leaving the readable inner body.
        expect(utils.container.textContent).toContain('{\n  "userId": 1\n}');
        expect(utils.container.textContent).not.toContain('\\"userId\\"');
    });

    it('falls back to a raw string when state_value is not valid JSON', async () => {
        const { messaging } = harness({
            getContractState: () => Promise.resolve({
                data: [{ state_key: 'note', state_value: 'not json' }],
                total: 1,
            }),
        });
        let utils;
        await domAct(async () => {
            utils = mount(messaging);
            await drain();
        });
        await domAct(async () => {
            expandState(utils);
            await drain();
        });
        expect(utils.container.textContent).toContain('note');
        expect(utils.container.textContent).toContain('not json');
    });

    it('still reads a normalised { key, value } row', async () => {
        const { messaging } = harness({
            getContractState: () => Promise.resolve({
                data: [{ key: 'k1', value: 'v1' }],
                total: 1,
            }),
        });
        let utils;
        await domAct(async () => {
            utils = mount(messaging);
            await drain();
        });
        await domAct(async () => {
            expandState(utils);
            await drain();
        });
        expect(utils.container.textContent).toContain('k1');
        expect(utils.container.textContent).toContain('v1');
    });

    // Falsification anchor: against the unfixed mapper (which only reads
    // row.key/row.KEY and row.value/row.VALUE) this row's key is '' and its
    // value is the literal string 'null', so this assertion goes red.
    it('does not render the key column blank for a state_key-only row', async () => {
        const { messaging } = harness({
            getContractState: () => Promise.resolve({
                data: [{ state_key: 'onlykey', state_value: '"v"' }],
                total: 1,
            }),
        });
        let utils;
        await domAct(async () => {
            utils = mount(messaging);
            await drain();
        });
        await domAct(async () => {
            expandState(utils);
            await drain();
        });
        const cells = Array.from(utils.container.querySelectorAll('td'));
        expect(cells.some((td) => td.textContent === 'onlykey')).toBe(true);
    });
});

describe('Execution history reads the explorer\'s real field names', () => {
    function executionsFixture() {
        return Promise.resolve({
            data: [
                {
                    action: 'EXECUTE',
                    action_index: '198',
                    block_index: '151407',
                    method_name: 'requestPrice',
                    status: 'valid',
                    gas_used: '6375',
                    emitted_count: 1,
                    caller: '[obfuscated]',
                    tx_hash: '[obfuscated]',
                },
                {
                    action: 'EXECUTE',
                    action_index: '196',
                    block_index: '151400',
                    method_name: 'onPrice',
                    status: 'reverted',
                    gas_used: '1200',
                    caller: '[obfuscated]',
                },
                {
                    action: 'DEPLOY',
                    action_index: '190',
                    block_index: '151300',
                    status: 'valid',
                },
            ],
            total: 3,
        });
    }

    it('shows the method name from method_name, not "(method)"', async () => {
        const { messaging } = harness({ getExecutionsForContract: executionsFixture });
        let utils;
        await domAct(async () => {
            utils = mount(messaging);
            await drain();
        });
        expect(utils.container.textContent).toContain('requestPrice');
        expect(utils.container.textContent).not.toContain('(method)');
    });

    it('falls back to action for a row with no method_name, reading "DEPLOY"', async () => {
        const { messaging } = harness({ getExecutionsForContract: executionsFixture });
        let utils;
        await domAct(async () => {
            utils = mount(messaging);
            await drain();
        });
        expect(utils.container.textContent).toContain('DEPLOY');
    });

    it('marks a reverted row distinguishably from a valid one', async () => {
        const { messaging } = harness({ getExecutionsForContract: executionsFixture });
        let utils;
        await domAct(async () => {
            utils = mount(messaging);
            await drain();
        });
        expect(utils.container.textContent).toContain('Reverted');
        expect(utils.container.textContent).toContain('Valid');
        // The two labels must not collapse into the same visible marker.
        expect(utils.container.textContent.indexOf('Reverted')).not.toBe(-1);
    });

    it('shows gas_used when present and drops the obfuscated caller line', async () => {
        const { messaging } = harness({ getExecutionsForContract: executionsFixture });
        let utils;
        await domAct(async () => {
            utils = mount(messaging);
            await drain();
        });
        expect(utils.container.textContent).toContain('6375');
        expect(utils.container.textContent).not.toContain('[obfuscated]');
        expect(utils.container.textContent).not.toContain('caller');
    });

    // Falsification anchor: against the unfixed render (row.method/row.METHOD
    // only, row.source only) every row here prints literally "(method)" and
    // this assertion goes red.
    it('does not render the literal placeholder for any row in this fixture', async () => {
        const { messaging } = harness({ getExecutionsForContract: executionsFixture });
        let utils;
        await domAct(async () => {
            utils = mount(messaging);
            await drain();
        });
        expect(utils.container.textContent).not.toContain('(method)');
    });
});
