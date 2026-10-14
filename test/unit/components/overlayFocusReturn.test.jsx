// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('../../../packages/core/src/shared/hooks/useReachability.js', () => ({
    useReachability: () => ({ overall: 'normal', perChain: [] }),
}));

import { AppHeader } from '../../../packages/core/src/shared/components/AppHeader.jsx';
import { HeaderSettingsButton } from '../../../packages/core/src/shared/components/HeaderSettingsButton.jsx';
import { NetworkFilter } from '../../../packages/core/src/shared/components/NetworkFilter.jsx';
import { NetworkStatusIndicator } from '../../../packages/core/src/shared/components/NetworkStatusIndicator.jsx';
import { PlatformSwitcher } from '../../../packages/core/src/shared/components/PlatformSwitcher.jsx';
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

    it('closes a nested network list before the settings dialog', () => {
        render(
            <HeaderSettingsButton
                chainRegistry={chainRegistry}
                coinFamilies={['bitcoin', 'litecoin']}
                networkFilter="all"
                onNetworkFilterChange={() => {}}
            />,
        );
        const settingsTrigger = screen.getByRole('button', { name: 'Settings' });
        fireEvent.click(settingsTrigger);
        const filterTrigger = screen.getByRole('button', { name: /All networks/ });
        fireEvent.click(filterTrigger);

        fireEvent.keyDown(window, { key: 'Escape' });

        expect(screen.queryByRole('listbox')).toBeNull();
        expect(screen.getByRole('dialog', { name: 'Wallet settings' })).toBeInTheDocument();
        expect(settingsTrigger).toHaveAttribute('aria-expanded', 'true');
        expect(filterTrigger).toHaveFocus();
    });

    it('returns header action menu focus after an outside press and an action', () => {
        const onScan = vi.fn();
        render(<AppHeader onScan={onScan} />);
        // Scan lives in the header action menu, which replaced the scan menu.
        const trigger = screen.getByRole('button', { name: 'Open menu' });

        fireEvent.click(trigger);
        screen.getByRole('menuitem', { name: 'Scan' }).focus();
        fireEvent.mouseDown(document.body);
        expect(screen.queryByRole('menu')).toBeNull();
        expect(trigger).toHaveFocus();

        fireEvent.click(trigger);
        fireEvent.click(screen.getByRole('menuitem', { name: 'Scan' }));
        expect(onScan).toHaveBeenCalledOnce();
        expect(trigger).toHaveFocus();
    });

    it('returns settings-popover focus after an outside press and an action', () => {
        const onOpenWalletPicker = vi.fn();
        render(
            <HeaderSettingsButton
                activeWallet={{ id: 'wallet-1', name: 'Main wallet' }}
                onOpenWalletPicker={onOpenWalletPicker}
            />,
        );
        const trigger = screen.getByRole('button', { name: 'Settings' });

        fireEvent.click(trigger);
        screen.getByRole('button', { name: 'Main wallet' }).focus();
        fireEvent.mouseDown(document.body);
        expect(screen.queryByRole('dialog', { name: 'Wallet settings' })).toBeNull();
        expect(trigger).toHaveFocus();

        fireEvent.click(trigger);
        fireEvent.click(screen.getByRole('button', { name: 'Main wallet' }));
        expect(onOpenWalletPicker).toHaveBeenCalledOnce();
        expect(trigger).toHaveFocus();
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

    it('returns platform-menu focus after an outside press and an action', () => {
        render(<PlatformSwitcher current="wallet" />);
        const trigger = screen.getByRole('button', { name: 'XChain platform sites' });

        fireEvent.click(trigger);
        screen.getAllByRole('menuitem').find((item) => item.tagName === 'A').focus();
        fireEvent.mouseDown(document.body);
        expect(screen.queryByRole('menu')).toBeNull();
        expect(trigger).toHaveFocus();

        fireEvent.click(trigger);
        const destination = screen.getAllByRole('menuitem').find((item) => item.tagName === 'A');
        fireEvent.click(destination);
        expect(screen.queryByRole('menu')).toBeNull();
        expect(trigger).toHaveFocus();
    });
});
