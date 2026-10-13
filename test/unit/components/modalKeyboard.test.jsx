// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    act,
    cleanup,
    fireEvent,
    render,
    screen,
} from '@testing-library/react';
import { AlertsOverlay } from '../../../packages/core/src/shared/components/AlertsOverlay.jsx';
import { BottomTabBar } from '../../../packages/core/src/shared/components/BottomTabBar.jsx';
import { ConfirmModal } from '../../../packages/core/src/shared/components/ConfirmModal.jsx';
import { DemoExitConfirm } from '../../../packages/core/src/shared/components/DemoExitConfirm.jsx';
import { GatedFileViewer } from '../../../packages/core/src/shared/components/GatedFileViewer.jsx';
import { NoticeModal } from '../../../packages/core/src/shared/components/NoticeModal.jsx';
import { resetBackStackForTests } from '../../../packages/core/src/ui/backStack.js';

const TEXT_FILE = Buffer.from('hello').toString('base64');

afterEach(() => {
    cleanup();
    resetBackStackForTests();
    vi.restoreAllMocks();
});

function DialogHost({ renderDialog }) {
    const [open, setOpen] = useState(false);
    return (
        <>
            <button type="button" onClick={() => setOpen(true)}>Open dialog</button>
            {open ? renderDialog(() => setOpen(false)) : null}
        </>
    );
}

async function openDialog() {
    const opener = screen.getByRole('button', { name: 'Open dialog' });
    opener.focus();
    fireEvent.click(opener);
    await act(async () => { await new Promise((resolve) => requestAnimationFrame(resolve)); });
    return opener;
}

async function escapeDialog(opener) {
    fireEvent.keyDown(window, { key: 'Escape' });
    await act(async () => {});
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(opener).toHaveFocus();
}

function activateFromKeyboard(button) {
    fireEvent.keyDown(button, { key: 'Enter', code: 'Enter', charCode: 13 });
    fireEvent.keyUp(button, { key: 'Enter', code: 'Enter', charCode: 13 });
    fireEvent.click(button, { detail: 0 });
}

describe('ConfirmModal keyboard contract', () => {
    it('focuses Cancel, wraps Tab, and restores the opener after Escape', async () => {
        render(
            <DialogHost renderDialog={(close) => (
                <ConfirmModal title="Delete?" onConfirm={() => {}} onCancel={close} />
            )} />,
        );
        const opener = await openDialog();
        const cancel = screen.getByRole('button', { name: 'Cancel' });
        const confirm = screen.getByRole('button', { name: 'Confirm' });

        expect(cancel).toHaveFocus();
        confirm.focus();
        fireEvent.keyDown(confirm, { key: 'Tab' });
        expect(cancel).toHaveFocus();
        fireEvent.keyDown(cancel, { key: 'Tab', shiftKey: true });
        expect(confirm).toHaveFocus();
        await escapeDialog(opener);
    });

    it('coalesces repeated Enter activation of the primary action', () => {
        const onConfirm = vi.fn();
        render(<ConfirmModal title="Delete?" onConfirm={onConfirm} onCancel={() => {}} />);
        const confirm = screen.getByRole('button', { name: 'Confirm' });

        activateFromKeyboard(confirm);
        activateFromKeyboard(confirm);

        expect(onConfirm).toHaveBeenCalledOnce();
    });
});

describe('DemoExitConfirm keyboard contract', () => {
    it('inherits safe focus, trapped Tab, Escape restoration, and guarded confirmation', async () => {
        const onConfirm = vi.fn();
        render(
            <DialogHost renderDialog={(close) => (
                <DemoExitConfirm
                    busy={false}
                    error={null}
                    onConfirm={onConfirm}
                    onCancel={close}
                />
            )} />,
        );
        const opener = await openDialog();
        const cancel = screen.getByRole('button', { name: 'Cancel' });
        const confirm = screen.getByRole('button', { name: 'Exit demo & wipe' });

        expect(cancel).toHaveFocus();
        confirm.focus();
        fireEvent.keyDown(confirm, { key: 'Tab' });
        expect(cancel).toHaveFocus();
        activateFromKeyboard(confirm);
        activateFromKeyboard(confirm);
        expect(onConfirm).toHaveBeenCalledOnce();
        await escapeDialog(opener);
    });
});

describe('NoticeModal keyboard contract', () => {
    it('focuses its safe action, traps Tab, closes once on Enter, and restores on Escape', async () => {
        const onClose = vi.fn();
        render(
            <DialogHost renderDialog={(close) => (
                <NoticeModal
                    title="Sent"
                    onClose={() => {
                        onClose();
                        close();
                    }}
                />
            )} />,
        );
        const opener = await openDialog();
        const ok = screen.getByRole('button', { name: 'OK' });

        expect(ok).toHaveFocus();
        fireEvent.keyDown(ok, { key: 'Tab' });
        expect(ok).toHaveFocus();
        await escapeDialog(opener);
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('runs its primary close action once for one Enter activation', () => {
        const onClose = vi.fn();
        render(<NoticeModal title="Sent" onClose={onClose} />);

        activateFromKeyboard(screen.getByRole('button', { name: 'OK' }));

        expect(onClose).toHaveBeenCalledOnce();
    });
});

describe('AlertsOverlay keyboard contract', () => {
    const alerts = [{
        id: 'upgrade',
        severity: 'warning',
        title: 'Upgrade recovery phrase',
        message: 'Upgrade before continuing.',
        action: { label: 'Upgrade', onSelect: vi.fn() },
    }];

    it('focuses Close, wraps Tab, and restores the opener after Escape', async () => {
        render(
            <DialogHost renderDialog={(close) => (
                <AlertsOverlay alerts={alerts} onClose={close} />
            )} />,
        );
        const opener = await openDialog();
        const close = screen.getByRole('button', { name: 'Close alerts' });
        const primary = screen.getByRole('button', { name: 'Upgrade' });

        expect(close).toHaveFocus();
        primary.focus();
        fireEvent.keyDown(primary, { key: 'Tab' });
        expect(close).toHaveFocus();
        fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
        expect(primary).toHaveFocus();
        await escapeDialog(opener);
    });

    it('runs the primary alert action once for one Enter activation', () => {
        const onSelect = vi.fn();
        const onClose = vi.fn();
        render(<AlertsOverlay alerts={[{ ...alerts[0], action: { label: 'Upgrade', onSelect } }]} onClose={onClose} />);

        activateFromKeyboard(screen.getByRole('button', { name: 'Upgrade' }));

        expect(onSelect).toHaveBeenCalledOnce();
        expect(onClose).toHaveBeenCalledOnce();
    });
});

describe('GatedFileViewer keyboard contract', () => {
    it('focuses Close, wraps Tab, and restores the opener after Escape', async () => {
        render(
            <DialogHost renderDialog={(close) => (
                <GatedFileViewer
                    name="note.txt"
                    declaredType="text/plain"
                    plaintextBase64={TEXT_FILE}
                    onClose={close}
                />
            )} />,
        );
        const opener = await openDialog();
        const close = screen.getByRole('button', { name: 'Close' });
        const download = screen.getByRole('button', { name: 'Download' });

        expect(close).toHaveFocus();
        download.focus();
        fireEvent.keyDown(download, { key: 'Tab' });
        expect(close).toHaveFocus();
        fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
        expect(download).toHaveFocus();
        await escapeDialog(opener);
    });

    it('starts one download for one Enter activation', () => {
        const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
        URL.createObjectURL = vi.fn(() => 'blob:download');
        URL.revokeObjectURL = vi.fn();
        render(
            <GatedFileViewer
                name="note.txt"
                declaredType="text/plain"
                plaintextBase64={TEXT_FILE}
                onClose={() => {}}
            />,
        );

        activateFromKeyboard(screen.getByRole('button', { name: 'Download' }));

        expect(anchorClick).toHaveBeenCalledOnce();
    });
});

describe('BottomTabBar modal sheet keyboard contract', () => {
    it('focuses the first choice, wraps Tab, and returns focus to More on Escape', async () => {
        render(
            <BottomTabBar
                currentView="home"
                onSelect={() => {}}
                onLock={() => {}}
            />,
        );
        const more = screen.getByRole('button', { name: 'More' });
        more.focus();
        fireEvent.click(more);
        await act(async () => { await new Promise((resolve) => requestAnimationFrame(resolve)); });
        const first = screen.getByRole('button', { name: 'Close more navigation' });
        const last = screen.getByRole('button', { name: 'Lock wallet' });

        expect(first).toHaveFocus();
        last.focus();
        fireEvent.keyDown(last, { key: 'Tab' });
        expect(first).toHaveFocus();
        fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
        expect(last).toHaveFocus();
        fireEvent.keyDown(window, { key: 'Escape' });
        await act(async () => {});
        expect(screen.queryByRole('dialog', { name: 'More' })).toBeNull();
        expect(more).toHaveFocus();
    });

    it('runs one navigation action for one Enter activation', () => {
        const onSelect = vi.fn();
        render(<BottomTabBar currentView="home" onSelect={onSelect} />);
        fireEvent.click(screen.getByRole('button', { name: 'More' }));

        activateFromKeyboard(screen.getByRole('button', { name: 'Receive' }));

        expect(onSelect).toHaveBeenCalledOnce();
    });
});
