// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('../../../packages/core/src/shared/hooks/useReachability.js', () => ({
    useReachability: () => ({ overall: 'normal', perChain: [] }),
}));

import { HeaderSettingsButton } from '../../../packages/core/src/shared/components/HeaderSettingsButton.jsx';
import { NetworkStatusIndicator } from '../../../packages/core/src/shared/components/NetworkStatusIndicator.jsx';

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('header popover focus return', () => {
    it('returns settings focus after an outside press', () => {
        render(
            <HeaderSettingsButton
                activeWallet={{ id: 'wallet-1', name: 'Main wallet' }}
                onOpenWalletPicker={() => {}}
            />,
        );
        const trigger = screen.getByRole('button', { name: 'Settings' });
        fireEvent.click(trigger);
        screen.getByRole('button', { name: 'Main wallet' }).focus();

        fireEvent.mouseDown(document.body);

        expect(screen.queryByRole('dialog', { name: 'Wallet settings' })).toBeNull();
        expect(trigger).toHaveFocus();
    });

    it('returns settings focus after an action closes the popover', () => {
        const onOpenWalletPicker = vi.fn();
        render(
            <HeaderSettingsButton
                activeWallet={{ id: 'wallet-1', name: 'Main wallet' }}
                onOpenWalletPicker={onOpenWalletPicker}
            />,
        );
        const trigger = screen.getByRole('button', { name: 'Settings' });
        fireEvent.click(trigger);

        fireEvent.click(screen.getByRole('button', { name: 'Main wallet' }));

        expect(onOpenWalletPicker).toHaveBeenCalledOnce();
        expect(trigger).toHaveFocus();
    });

    it('returns network-status focus after an outside press', () => {
        render(<NetworkStatusIndicator onOpenNetworkSettings={() => {}} />);
        const trigger = screen.getByRole('button', { name: 'Network connected' });
        const wrap = trigger.closest('[data-open]');
        fireEvent.click(trigger);
        screen.getByRole('button', { name: 'Network settings' }).focus();

        fireEvent.mouseDown(document.body);

        expect(wrap).toHaveAttribute('data-open', 'false');
        expect(trigger).toHaveFocus();
    });

    it('returns network-status focus after its action closes the popover', () => {
        const onOpenNetworkSettings = vi.fn();
        render(<NetworkStatusIndicator onOpenNetworkSettings={onOpenNetworkSettings} />);
        const trigger = screen.getByRole('button', { name: 'Network connected' });
        fireEvent.click(trigger);

        fireEvent.click(screen.getByRole('button', { name: 'Network settings' }));

        expect(onOpenNetworkSettings).toHaveBeenCalledOnce();
        expect(trigger.closest('[data-open]')).toHaveAttribute('data-open', 'false');
        expect(trigger).toHaveFocus();
    });
});
