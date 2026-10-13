// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react';
import React, { useState } from 'react';

import {
    MAX_TICK_LOOKUPS,
    TickItemsEditor,
} from '../../../packages/core/src/shared/components/TickItemsEditor.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';
import { classifyTickItems } from '../../../packages/core/src/shared/utils/listTickItems.js';

const FOUND = { creator: 'bc1qcreator', totalSupply: '100', canonicalTick: 'GOODTOK' };
const EMPTY = { creator: null, totalSupply: null, canonicalTick: null };

function Harness({
    initial,
    messaging,
    onOpenPicker = () => {},
    onStatus,
    active = true,
    coinQualified = false,
}) {
    const [text, setText] = useState(initial);
    const [status, setStatus] = useState({});
    return active ? (
        <TickItemsEditor
            value={text}
            onChange={setText}
            items={classifyTickItems(text, { coinQualified })}
            chainId="bitcoin-mainnet"
            chainLabel="Bitcoin"
            listCoin="BTC"
            coinQualified={coinQualified}
            messaging={messaging}
            onOpenPicker={onOpenPicker}
            status={status}
            onStatusChange={(s) => { setStatus(s); onStatus?.(s); }}
        />
    ) : null;
}

function fakeMessaging(records) {
    return { getTokenInfo: vi.fn(({ tick }) => Promise.resolve(records[tick] ?? null)) };
}

async function settle() {
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
}

beforeEach(() => { vi.useFakeTimers(); __clearTokenInfoCache(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('TickItemsEditor', () => {
    it('counts valid, duplicate and invalid names', async () => {
        const messaging = fakeMessaging({});
        render(<Harness initial={'AAA\naaa\nBBB\nbad name!'} messaging={messaging} />);
        expect(screen.getByText(/2 valid token names · 1 duplicate ignored · 1 invalid/)).toBeInTheDocument();
        expect(screen.getByText('Not a token name: bad name!')).toBeInTheDocument();
        await settle();
    });

    it('removes and reorders valid entries without discarding invalid input', () => {
        render(<Harness initial={'FIRST\nbad name!\nSECOND\nTHIRD'} messaging={fakeMessaging({})} />);
        const input = screen.getByLabelText('Tokens (one per line)');

        fireEvent.click(screen.getByRole('button', { name: 'Move THIRD up' }));
        expect(input).toHaveValue('FIRST\nbad name!\nTHIRD\nSECOND');
        expect(screen.getByText('Not a token name: bad name!')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Remove FIRST' }));
        expect(input).toHaveValue('bad name!\nTHIRD\nSECOND');
        expect(screen.getByRole('listitem', { name: 'THIRD, position 1 of 2' })).toHaveFocus();
    });

    it('supports keyboard reordering and announces the result', () => {
        render(<Harness initial={'FIRST\nSECOND'} messaging={fakeMessaging({})} />);
        const second = screen.getByRole('listitem', { name: 'SECOND, position 2 of 2' });
        second.focus();
        fireEvent.keyDown(second, { key: 'ArrowUp', altKey: true });

        expect(screen.getByLabelText('Tokens (one per line)')).toHaveValue('SECOND\nFIRST');
        expect(screen.getByRole('status')).toHaveTextContent('SECOND moved to position 1.');
        expect(screen.getByRole('listitem', { name: 'SECOND, position 1 of 2' })).toHaveFocus();
    });

    it('disambiguates controls for the same ticker on different coins', () => {
        render(
            <Harness
                initial={'BTC:SAME\nDOGE:SAME'}
                messaging={fakeMessaging({})}
                coinQualified
            />,
        );

        expect(screen.getByLabelText('Coin for BTC:SAME')).toHaveValue('BTC');
        expect(screen.getByLabelText('Coin for DOGE:SAME')).toHaveValue('DOGE');
        fireEvent.click(screen.getByRole('button', { name: 'Move DOGE:SAME up' }));
        expect(screen.getByLabelText('Tokens (one per line)')).toHaveValue('DOGE:SAME\nBTC:SAME');
    });

    it('accepts a many-line paste and caps token lookups', async () => {
        const ticks = Array.from({ length: MAX_TICK_LOOKUPS + 5 }, (_, index) => `TOKEN${index}`);
        const messaging = fakeMessaging(Object.fromEntries(ticks.map((tick) => [tick, FOUND])));
        render(<Harness initial="" messaging={messaging} />);

        fireEvent.change(screen.getByLabelText('Tokens (one per line)'), {
            target: { value: ticks.join('\n') },
        });
        expect(screen.getByText(`${ticks.length} valid token names · checking…`)).toBeInTheDocument();
        await settle();
        expect(messaging.getTokenInfo).toHaveBeenCalledTimes(MAX_TICK_LOOKUPS);
        expect(screen.getByText(/50 found · 5 not checked/)).toBeInTheDocument();
    });

    it('reports a found and a missing verdict after the lookup and warns about the missing one', async () => {
        const messaging = fakeMessaging({ GOODTOK: FOUND, NOSUCH: EMPTY });
        const onStatus = vi.fn();
        render(<Harness initial={'GOODTOK\nNOSUCH'} messaging={messaging} onStatus={onStatus} />);
        expect(screen.getByText(/checking…/)).toBeInTheDocument();
        expect(messaging.getTokenInfo).not.toHaveBeenCalled();
        await settle();
        expect(messaging.getTokenInfo).toHaveBeenCalledTimes(2);
        expect(onStatus).toHaveBeenLastCalledWith({ GOODTOK: 'found', NOSUCH: 'missing' });
        expect(screen.getByText(/1 found · 1 not found/)).toBeInTheDocument();
        expect(screen.getByRole('alert')).toHaveTextContent('Not found on Bitcoin: NOSUCH.');
    });

    it('skips a ^ reference and shows it as not checked', async () => {
        const messaging = fakeMessaging({ GOODTOK: FOUND });
        render(<Harness initial={'GOODTOK\n^123'} messaging={messaging} />);
        await settle();
        expect(messaging.getTokenInfo).toHaveBeenCalledTimes(1);
        expect(screen.getByText(/1 not checked/)).toBeInTheDocument();
        expect(screen.getByText('Not checked: ^123.')).toBeInTheDocument();
    });

    it('opens the token picker from its button', () => {
        const onOpenPicker = vi.fn();
        render(<Harness initial="" messaging={fakeMessaging({})} onOpenPicker={onOpenPicker} />);
        fireEvent.click(screen.getByRole('button', { name: 'Add from token picker' }));
        expect(onOpenPicker).toHaveBeenCalledTimes(1);
    });

    it('clears lookup verdicts when the editor unmounts', async () => {
        const messaging = fakeMessaging({ NOSUCH: EMPTY });
        const onStatus = vi.fn();
        const view = render(<Harness initial="NOSUCH" messaging={messaging} onStatus={onStatus} />);
        await settle();
        expect(onStatus).toHaveBeenLastCalledWith({ NOSUCH: 'missing' });
        view.rerender(<Harness initial="NOSUCH" messaging={messaging} onStatus={onStatus} active={false} />);
        expect(onStatus).toHaveBeenLastCalledWith({});
    });
});
