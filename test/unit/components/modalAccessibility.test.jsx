// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { expectNoSeriousAxeViolations } from '../../a11y/helpers/axe.js';
import { CommandPalette } from '../../../packages/core/src/shared/commandPalette/CommandPalette.jsx';
import { AlertsOverlay } from '../../../packages/core/src/shared/components/AlertsOverlay.jsx';
import { BottomTabBar } from '../../../packages/core/src/shared/components/BottomTabBar.jsx';
import { ConfirmModal } from '../../../packages/core/src/shared/components/ConfirmModal.jsx';
import { GatedFileViewer } from '../../../packages/core/src/shared/components/GatedFileViewer.jsx';
import { HeaderSettingsButton } from '../../../packages/core/src/shared/components/HeaderSettingsButton.jsx';
import { NoticeModal } from '../../../packages/core/src/shared/components/NoticeModal.jsx';
import { ShortcutHelp } from '../../../packages/core/src/shared/keyboard/ShortcutHelp.jsx';

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

const noop = () => {};

describe('open modal accessibility', () => {
    it('renders the command palette without serious axe violations', async () => {
        const { container } = render(
            <CommandPalette
                open
                onClose={noop}
                commands={[
                    { id: 'home', category: 'Navigate', title: 'Home', run: noop },
                    { id: 'send', category: 'Navigate', title: 'Send', run: noop },
                ]}
            />,
        );

        await expectNoSeriousAxeViolations(container);
    });

    it('renders the alerts modal without serious axe violations', async () => {
        const { container } = render(
            <AlertsOverlay
                alerts={[{
                    id: 'upgrade',
                    severity: 'critical',
                    title: 'Recovery phrase update required',
                    message: 'Upgrade the recovery phrase before continuing.',
                    action: { label: 'Upgrade', onSelect: noop },
                }]}
                onClose={noop}
            />,
        );

        await expectNoSeriousAxeViolations(container);
    });

    it('renders the More bottom sheet without serious axe violations', async () => {
        const { container } = render(
            <BottomTabBar
                currentView="home"
                onSelect={noop}
                onLock={noop}
                onOpenWalletPicker={noop}
                onOpenSettings={noop}
                hasVmAddress
                hasDexSurface
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: 'More' }));

        await expectNoSeriousAxeViolations(container);
    });

    it('renders the header settings dialog without serious axe violations', async () => {
        const { container } = render(
            <HeaderSettingsButton
                activeWallet={{ id: 'wallet-1', name: 'Main wallet' }}
                activeAccount={{ id: 'account-1', index: 0, name: 'Savings' }}
                onOpenWalletPicker={noop}
                onOpenAccountPicker={noop}
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: 'Settings' }));

        await expectNoSeriousAxeViolations(container);
    });

    it('renders the gated-file modal without serious axe violations', async () => {
        const { container } = render(
            <GatedFileViewer
                name="message.txt"
                declaredType="text/plain"
                plaintextBase64={Buffer.from('hello').toString('base64')}
                onClose={noop}
            />,
        );

        await expectNoSeriousAxeViolations(container);
    });

    it('renders shortcut help without serious axe violations', async () => {
        const { container } = render(<ShortcutHelp open onClose={noop} />);

        await expectNoSeriousAxeViolations(container);
    });

    it('renders a notice dialog without serious axe violations', async () => {
        const { container } = render(
            <NoticeModal
                title="Message sent"
                message="The message is waiting for confirmation."
                onClose={noop}
            />,
        );

        await expectNoSeriousAxeViolations(container);
    });

    it.each([
        ['standard', false, 'Leave'],
        ['destructive', true, 'Remove'],
    ])('renders the %s confirm dialog without serious axe violations', async (
        _variant,
        danger,
        confirmLabel,
    ) => {
        const { container } = render(
            <ConfirmModal
                title={danger ? 'Remove this contact?' : 'Leave this screen?'}
                message={danger ? 'This cannot be undone.' : 'The form is not saved.'}
                confirmLabel={confirmLabel}
                danger={danger}
                onConfirm={noop}
                onCancel={noop}
            />,
        );

        await expectNoSeriousAxeViolations(container);
    });
});
