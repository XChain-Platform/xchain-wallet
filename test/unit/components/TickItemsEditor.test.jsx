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

import { TickItemsEditor } from '../../../packages/core/src/shared/components/TickItemsEditor.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';
import { classifyTickItems } from '../../../packages/core/src/shared/utils/listTickItems.js';

const FOUND = { creator: 'bc1qcreator', totalSupply: '100', canonicalTick: 'GOODTOK' };
const EMPTY = { creator: null, totalSupply: null, canonicalTick: null };

function Harness({ initial, messaging, onOpenPicker = () => {}, onStatus, active = true }) {
    const [text, setText] = useState(initial);
    const [status, setStatus] = useState({});
    return active ? (
        <TickItemsEditor
            value={text}
            onChange={setText}
            items={classifyTickItems(text)}
            chainId="bitcoin-mainnet"
            chainLabel="Bitcoin"
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
        expect(screen.getByText(/2 valid token names · 1 duplicate removed · 1 invalid/)).toBeInTheDocument();
        expect(screen.getByText('Not a token name: bad name!')).toBeInTheDocument();
        await settle();
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
