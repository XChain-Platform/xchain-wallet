// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A form carries one notice per state: its caution, its saved draft and the
// shell's "Some balances may be out of date" share one box with a line each.

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';

const useReachability = vi.hoisted(() => vi.fn());
vi.mock('../../../packages/core/src/shared/hooks/useReachability.js', () => ({ useReachability }));

import { FullLayoutWithNav } from '../../../packages/core/src/shared/components/LeftNav.jsx';
import { ReachabilityBanner } from '../../../packages/core/src/shared/components/ReachabilityBanner.jsx';
import { HideReachabilityNotice } from '../../../packages/core/src/shared/components/hideReachabilityNotice.js';
import { FormNotice, FormPage, Screen, StatusMessage } from '../../../packages/core/src/ui/index.js';

let savedResizeObserver;
beforeAll(() => {
    savedResizeObserver = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
});
afterAll(() => { globalThis.ResizeObserver = savedResizeObserver; });
afterEach(() => { cleanup(); useReachability.mockReset(); });

function boxes(container) {
    const all = [...container.querySelectorAll('[data-variant]')];
    return all.filter((el) => !all.some((other) => other !== el && other.contains(el)));
}

function mountInShell(overall, form, refresh = () => {}, state = {}) {
    useReachability.mockReturnValue({
        loading: false, overall, perChain: [], refresh, lastChecked: null, ...state,
    });
    return render(
        <FullLayoutWithNav routeKey="destroy:1" notices={<ReachabilityBanner />}>
            <Screen>{form}</Screen>
        </FullLayoutWithNav>,
    );
}

describe('one notice box per form', () => {
    it('merges the form status and a notice raised from its body', () => {
        const restore = vi.fn();
        const { container } = render(
            <FormPage
                status={[
                    <StatusMessage key="draft" variant="status" recovery={{ label: 'Restore', onAction: restore }}>
                        Your unfinished draft was saved.
                    </StatusMessage>,
                ]}
            >
                <FormNotice lead="Destroy is irreversible.">The burned amount cannot be recovered.</FormNotice>
            </FormPage>,
        );
        const shown = boxes(container);
        expect(shown).toHaveLength(1);
        expect(shown[0]).toHaveAttribute('data-variant', 'warning');
        expect(shown[0]).toHaveTextContent('Your unfinished draft was saved.');
        expect(shown[0]).toHaveTextContent('Destroy is irreversible. The burned amount cannot be recovered.');
        fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
        expect(restore).toHaveBeenCalledTimes(1);
    });

    it('keeps a notice and its button in place when a second notice arrives', () => {
        function Form() {
            const [fee, setFee] = useState(false);
            return (
                <FormPage status={<StatusMessage key="draft" recovery={{ label: 'Restore', onAction: () => {} }}>Draft saved.</StatusMessage>}>
                    {fee ? <FormNotice>Live fee estimate unavailable.</FormNotice> : null}
                    <button type="button" onClick={() => setFee(true)}>Load fees</button>
                </FormPage>
            );
        }
        render(<Form />);
        const restore = screen.getByRole('button', { name: 'Restore' });
        fireEvent.click(screen.getByRole('button', { name: 'Load fees' }));
        expect(screen.getByText('Live fee estimate unavailable.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Restore' })).toBe(restore);
    });

    it('keeps a lone notice as one box that still carries its id', () => {
        const { container } = render(
            <FormPage status={<StatusMessage variant="error" className="mine" id="err">Amount is too large.</StatusMessage>}>
                <input aria-label="Amount" />
            </FormPage>,
        );
        const shown = boxes(container);
        expect(shown).toHaveLength(1);
        expect(shown[0]).toHaveAttribute('data-variant', 'error');
        expect(shown[0].querySelector('#err')).toHaveTextContent('Amount is too large.');
    });

    it('folds the shell reachability sentence into the form notice', () => {
        const refresh = vi.fn();
        const { container } = mountInShell('offline', (
            <FormPage>
                <FormNotice lead="Destroy is irreversible.">The burned amount cannot be recovered.</FormNotice>
            </FormPage>
        ), refresh);
        const shown = boxes(container);
        expect(shown).toHaveLength(1);
        expect(shown[0]).toHaveTextContent('Some balances may be out of date');
        expect(shown[0]).toHaveTextContent('Destroy is irreversible.');
        expect(screen.queryByRole('button', { name: 'Details' })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
        expect(refresh).toHaveBeenCalledTimes(1);
    });

    it('keeps the Details control on the sentence folded into the form notice', () => {
        const { container } = mountInShell('offline', (
            <FormPage>
                <FormNotice lead="Destroy is irreversible.">The burned amount cannot be recovered.</FormNotice>
            </FormPage>
        ), () => {}, {
            perChain: [{ chainId: 'bitcoin-mainnet', mode: 'offline', services: {} }],
            lastChecked: Date.now() - 5000,
        });
        const shown = boxes(container);
        expect(shown).toHaveLength(1);
        const details = screen.getByRole('button', { name: 'Details' });
        expect(shown[0]).toContainElement(details);
        expect(details).toHaveAttribute('aria-expanded', 'false');
        fireEvent.click(details);
        expect(details).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByRole('list', { name: 'Affected coins' })).toHaveTextContent('Bitcoin');
        expect(shown[0]).toHaveTextContent('Last checked');
        expect(boxes(container)).toHaveLength(1);
    });

    it('does not repeat the outage on a form that states it itself', () => {
        const { container } = mountInShell('offline', (
            <FormPage
                status={(
                    <>
                        <HideReachabilityNotice />
                        <StatusMessage variant="warning">Sending needs a network connection.</StatusMessage>
                    </>
                )}
            >
                <FormNotice>This wallet has no funds to send yet.</FormNotice>
            </FormPage>
        ));
        const shown = boxes(container);
        expect(shown).toHaveLength(1);
        expect(shown[0]).toHaveTextContent('Sending needs a network connection.');
        expect(shown[0]).toHaveTextContent('This wallet has no funds to send yet.');
        expect(screen.queryByText(/may be out of date/)).toBeNull();
    });

    it('leaves the shell notice in place over a form with no notice of its own', () => {
        const { container } = mountInShell('degraded', (
            <FormPage><input aria-label="Amount" /></FormPage>
        ));
        const shown = boxes(container);
        expect(shown).toHaveLength(1);
        expect(shown[0]).toHaveTextContent('Some balances may be out of date');
        expect(shown[0].querySelector('[role="status"][aria-live="polite"]')).not.toBeNull();
    });
});
