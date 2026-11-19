// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('../../../packages/core/src/shared/hooks/useReachability.js', () => ({
    useReachability: () => ({ overall: 'normal', perChain: [] }),
}));

import { NetworkFilter } from '../../../packages/core/src/shared/components/NetworkFilter.jsx';
import { NetworkStatusIndicator } from '../../../packages/core/src/shared/components/NetworkStatusIndicator.jsx';
import { ChainPicker } from '../../../packages/core/src/ui/ChainPicker.jsx';
import { IconSelect } from '../../../packages/core/src/ui/IconSelect.jsx';
import { resetBackStackForTests, useBackHandler } from '../../../packages/core/src/ui/backStack.js';

const chainRegistry = {
    get: (id) => ({ id, displayName: id === 'btc' ? 'Bitcoin' : 'Litecoin', coin: id.toUpperCase() }),
    byCoin: (coin) => [{ id: coin, displayName: coin === 'bitcoin' ? 'Bitcoin' : 'Litecoin' }],
};

function ParentLayer({ onBack, children }) {
    useBackHandler(onBack);
    return children;
}

beforeEach(() => resetBackStackForTests());

afterEach(() => {
    cleanup();
    resetBackStackForTests();
    vi.restoreAllMocks();
});

describe('overlay focus return', () => {
    it('keeps ChainPicker above its parent layer and restores focus after dismissal', () => {
        const onParentBack = vi.fn();
        render(
            <ParentLayer onBack={onParentBack}>
                <ChainPicker
                    label="Network"
                    value="btc"
                    chainIds={['btc', 'ltc']}
                    chainRegistry={chainRegistry}
                    onChange={() => {}}
                />
            </ParentLayer>,
        );
        const trigger = screen.getByRole('button', { name: 'Network: Bitcoin' });

        // ChainPicker opens the full-screen network list; its Back and
        // Escape close only the list, never the parent layer.
        fireEvent.click(trigger);
        fireEvent.click(screen.getByRole('button', { name: /Back/ }));
        expect(screen.queryByRole('dialog', { name: 'Network' })).toBeNull();
        expect(trigger).toHaveFocus();

        fireEvent.click(trigger);
        expect(screen.getByRole('dialog', { name: 'Network' })).toBeInTheDocument();
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(screen.queryByRole('dialog', { name: 'Network' })).toBeNull();
        expect(trigger).toHaveFocus();
        expect(onParentBack).not.toHaveBeenCalled();
    });

    it('keeps IconSelect above its parent layer and restores focus after dismissal', () => {
        const onParentBack = vi.fn();
        render(
            <ParentLayer onBack={onParentBack}>
                <IconSelect
                    label="Privacy"
                    value="private"
                    options={[
                        { value: 'private', label: 'Private' },
                        { value: 'public', label: 'Public' },
                    ]}
                    onChange={() => {}}
                />
            </ParentLayer>,
        );
        const trigger = screen.getByRole('button', { name: 'Privacy: Private' });

        fireEvent.click(trigger);
        fireEvent.mouseDown(document.body);
        expect(screen.queryByRole('listbox')).toBeNull();
        expect(trigger).toHaveFocus();

        fireEvent.click(trigger);
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(screen.queryByRole('listbox')).toBeNull();
        expect(trigger).toHaveFocus();
        expect(onParentBack).not.toHaveBeenCalled();
    });

    it('keeps NetworkFilter above its parent layer and restores focus after dismissal', () => {
        const onParentBack = vi.fn();
        render(
            <ParentLayer onBack={onParentBack}>
                <NetworkFilter
                    chainRegistry={chainRegistry}
                    coinFamilies={['bitcoin', 'litecoin']}
                    value="all"
                    onChange={() => {}}
                />
            </ParentLayer>,
        );
        const trigger = screen.getByRole('button', { name: /All networks/ });

        // The filter opens the full-screen network list; its Back and Escape
        // close only the list, never the parent layer.
        fireEvent.click(trigger);
        fireEvent.click(screen.getByRole('button', { name: /^Back/ }));
        expect(screen.queryByRole('dialog', { name: 'Network' })).toBeNull();
        expect(trigger).toHaveFocus();

        fireEvent.click(trigger);
        expect(screen.getByRole('dialog', { name: 'Network' })).toBeInTheDocument();
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(screen.queryByRole('dialog', { name: 'Network' })).toBeNull();
        expect(trigger).toHaveFocus();
        expect(onParentBack).not.toHaveBeenCalled();
    });

    it('returns network-status focus after an outside press and an action', () => {
        const onOpenNetworkSettings = vi.fn();
        render(<NetworkStatusIndicator onOpenNetworkSettings={onOpenNetworkSettings} />);
        // The trigger name leads with the active network, then the state.
        const trigger = screen.getByRole('button', { name: /Network connected/ });

        fireEvent.click(trigger);
        screen.getByRole('button', { name: 'Network settings' }).focus();
        fireEvent.mouseDown(document.body);
        expect(trigger).toHaveAttribute('aria-expanded', 'false');
        expect(trigger).toHaveFocus();

        fireEvent.click(trigger);
        fireEvent.click(screen.getByRole('button', { name: 'Network settings' }));
        expect(onOpenNetworkSettings).toHaveBeenCalledOnce();
        expect(trigger).toHaveFocus();
    });
});
