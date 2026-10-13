// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { WalletDetails } from '../../../packages/core/src/shared/routes/WalletDetails.jsx';
import { WalletPicker } from '../../../packages/core/src/shared/routes/WalletPicker.jsx';

afterEach(() => cleanup());

describe('WalletPicker row layout', () => {
    it('truncates a long wallet name while preserving its full tooltip', async () => {
        const wallet = {
            id: 'wallet-1',
            name: 'A wallet name long enough to wrap on a narrow screen',
            origin: 'demo',
            format: 'bip39',
        };
        await act(async () => {
            render(
                <MessagingProvider
                    shell="popup"
                    messaging={{ listWallets: () => Promise.resolve([wallet]) }}
                >
                    <WalletPicker
                        activeWalletId={null}
                        onSwitch={() => {}}
                        onAddWallet={() => {}}
                        onBack={() => {}}
                    />
                </MessagingProvider>,
            );
            await Promise.resolve();
        });

        const row = screen.getByRole('button', { name: new RegExp(`^${wallet.name}`) });
        expect(row.children).toHaveLength(1);
        expect(row.firstElementChild.children).toHaveLength(2);
        expect(row.firstElementChild.textContent).toContain('Demo wallet · BIP39');
        expect(screen.getByTitle(wallet.name)).toHaveTextContent(wallet.name);

        const css = readFileSync(
            join(process.cwd(), 'packages/core/src/shared/routes/WalletPicker.module.css'),
            'utf8',
        );
        const nameRule = /\.rowName\s*\{([^}]*)\}/.exec(css)?.[1] || '';
        expect(nameRule).toMatch(/overflow:\s*hidden/);
        expect(nameRule).toMatch(/text-overflow:\s*ellipsis/);
        expect(nameRule).toMatch(/white-space:\s*nowrap/);
    });

    it('marks the current wallet and keeps add and manage actions in the footer', async () => {
        const wallet = { id: 'wallet-1', name: 'Primary', format: 'bip39' };
        const onShowDetails = vi.fn();
        await act(async () => {
            render(
                <MessagingProvider
                    shell="popup"
                    messaging={{ listWallets: () => Promise.resolve([wallet]) }}
                >
                    <WalletPicker
                        activeWalletId={wallet.id}
                        onSwitch={() => {}}
                        onAddWallet={() => {}}
                        onShowDetails={onShowDetails}
                        onBack={() => {}}
                    />
                </MessagingProvider>,
            );
            await Promise.resolve();
        });

        expect(screen.getByRole('button', { current: true })).toHaveTextContent('Primary');
        const add = screen.getByRole('button', { name: 'Add wallet' });
        const manage = screen.getByRole('button', { name: 'Manage wallet' });
        expect(add.closest('footer')).toBeTruthy();
        expect(manage.closest('footer')).toBeTruthy();

        fireEvent.click(manage);
        expect(onShowDetails).toHaveBeenCalledWith(wallet.id);
    });

    it('labels imported-key wallets accurately', async () => {
        const wallet = {
            id: 'wallet-1',
            name: 'Imported wallet',
            origin: 'imported-wif',
            format: 'wif-only',
        };
        render(
            <MessagingProvider
                shell="popup"
                messaging={{ listWallets: () => Promise.resolve([wallet]) }}
            >
                <WalletPicker
                    activeWalletId={null}
                    onSwitch={() => {}}
                    onAddWallet={() => {}}
                    onBack={() => {}}
                />
            </MessagingProvider>,
        );

        expect(await screen.findByText('Imported key')).toBeTruthy();
    });

    it('uses distinct React keys when a malformed list repeats an id', async () => {
        const duplicateIdWallets = [
            { id: 'wallet-1', name: 'First', format: 'bip39' },
            { id: 'wallet-1', name: 'Duplicate', format: 'bip39' },
        ];
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        try {
            render(
                <MessagingProvider
                    shell="popup"
                    messaging={{ listWallets: () => Promise.resolve(duplicateIdWallets) }}
                >
                    <WalletPicker
                        activeWalletId={null}
                        onSwitch={() => {}}
                        onAddWallet={() => {}}
                        onBack={() => {}}
                    />
                </MessagingProvider>,
            );

            expect(await screen.findByText('Duplicate')).toBeTruthy();
            const keyWarnings = consoleError.mock.calls.filter(([message]) => (
                String(message).includes('same key')
            ));
            expect(keyWarnings).toHaveLength(0);
        } finally {
            consoleError.mockRestore();
        }
    });

    it('renders a synchronous wallet-list failure as an error', async () => {
        render(
            <MessagingProvider
                shell="popup"
                messaging={{ listWallets: () => { throw new Error('transport unavailable'); } }}
            >
                <WalletPicker
                    activeWalletId={null}
                    onSwitch={() => {}}
                    onAddWallet={() => {}}
                    onBack={() => {}}
                />
            </MessagingProvider>,
        );

        expect(await screen.findByText('transport unavailable')).toBeTruthy();
    });
});

describe('WalletPicker switching', () => {
    const wallets = [
        { id: 'wallet-1', name: 'Primary', format: 'bip39' },
        { id: 'wallet-2', name: 'Savings', format: 'bip39' },
    ];

    function mountPicker(onSwitch, onBack = vi.fn()) {
        render(
            <MessagingProvider
                shell="popup"
                messaging={{ listWallets: () => Promise.resolve(wallets) }}
            >
                <WalletPicker
                    activeWalletId="wallet-1"
                    onSwitch={onSwitch}
                    onAddWallet={() => {}}
                    onBack={onBack}
                />
            </MessagingProvider>,
        );
        return { onBack };
    }

    it('waits for a switch to finish and locks every escape path', async () => {
        let finishSwitch;
        const onSwitch = vi.fn(() => new Promise((resolve) => {
            finishSwitch = resolve;
        }));
        const { onBack } = mountPicker(onSwitch);
        const savings = await screen.findByRole('button', { name: /Savings/ });

        fireEvent.click(savings);

        expect(onSwitch).toHaveBeenCalledWith('wallet-2');
        expect(onBack).not.toHaveBeenCalled();
        expect(screen.getByRole('button', { name: 'Back to previous screen' }).disabled).toBe(true);
        expect(screen.getByRole('button', { name: 'Add wallet' }).disabled).toBe(true);
        expect(savings.disabled).toBe(true);
        expect(savings.getAttribute('aria-busy')).toBe('true');

        finishSwitch();
        await waitFor(() => expect(onBack).toHaveBeenCalledOnce());
    });

    it('stays on the picker and permits retry when switching fails', async () => {
        const onSwitch = vi.fn().mockRejectedValue(new Error('Switch refused'));
        const { onBack } = mountPicker(onSwitch);
        const savings = await screen.findByRole('button', { name: /Savings/ });

        fireEvent.click(savings);

        expect(await screen.findByText('Switch refused')).toBeTruthy();
        expect(onBack).not.toHaveBeenCalled();
        await waitFor(() => expect(savings.disabled).toBe(false));
        expect(screen.getByRole('button', { name: 'Back to previous screen' }).disabled).toBe(false);
    });

    it('closes from both the current selection and the Back control', async () => {
        const onSwitch = vi.fn();
        const { onBack } = mountPicker(onSwitch);
        const primary = await screen.findByRole('button', { name: /Primary/ });

        fireEvent.click(primary);
        fireEvent.click(screen.getByRole('button', { name: 'Back to previous screen' }));

        expect(onSwitch).not.toHaveBeenCalled();
        expect(onBack).toHaveBeenCalledTimes(2);
    });

    it('admits only one wallet switch before React commits the busy state', async () => {
        let finishSwitch;
        const onSwitch = vi.fn(() => new Promise((resolve) => {
            finishSwitch = resolve;
        }));
        mountPicker(onSwitch);
        const savings = await screen.findByRole('button', { name: /Savings/ });

        act(() => {
            savings.click();
            savings.click();
        });

        expect(onSwitch).toHaveBeenCalledOnce();
        await act(async () => finishSwitch());
    });
});

describe('WalletDetails wallet changes', () => {
    it('hides the prior wallet until the requested wallet finishes loading', async () => {
        const firstWallet = { id: 'wallet-1', name: 'First', format: 'bip39' };
        const secondWallet = { id: 'wallet-2', name: 'Second', format: 'bip39' };
        let resolveSecond;
        const messaging = {
            listWallets: vi.fn()
                .mockResolvedValueOnce([firstWallet])
                .mockImplementationOnce(() => new Promise((resolve) => {
                    resolveSecond = resolve;
                })),
            listAccounts: vi.fn().mockResolvedValue([]),
        };
        const onRename = vi.fn();
        const view = render(
            <MessagingProvider shell="popup" messaging={messaging}>
                <WalletDetails
                    walletId={firstWallet.id}
                    onBack={() => {}}
                    onRename={onRename}
                />
            </MessagingProvider>,
        );
        expect(await screen.findByText(firstWallet.name)).toBeTruthy();

        view.rerender(
            <MessagingProvider shell="popup" messaging={messaging}>
                <WalletDetails
                    walletId={secondWallet.id}
                    onBack={() => {}}
                    onRename={onRename}
                />
            </MessagingProvider>,
        );

        expect(screen.queryByRole('button', { name: 'Rename wallet' })).not.toBeInTheDocument();
        await waitFor(() => expect(resolveSecond).toBeTypeOf('function'));
        resolveSecond([secondWallet]);
        expect(await screen.findByText(secondWallet.name)).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Rename wallet' }));
        expect(onRename).toHaveBeenCalledWith(secondWallet);
    });

    it('renders a synchronous wallet-detail load failure as an error', async () => {
        render(
            <MessagingProvider
                shell="popup"
                messaging={{
                    listWallets: () => { throw new Error('detail transport unavailable'); },
                    listAccounts: () => { throw new Error('account transport unavailable'); },
                }}
            >
                <WalletDetails walletId="wallet-1" onBack={() => {}} />
            </MessagingProvider>,
        );

        expect(await screen.findByText('detail transport unavailable')).toBeTruthy();
    });
});
