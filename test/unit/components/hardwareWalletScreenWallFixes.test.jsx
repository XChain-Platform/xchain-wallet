// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Hardware wallet defects found on the 2026-11-15 screen wall:
//   1 My Wallets read a hardware wallet as "BIP39".
//   2 Wallet Details showed the raw model id ("Ledger nanoSP").
//   3 Try Again on Add account's waiting rows broke to "Try Agai / n" at 360px.
//   4 The sign page had no width limit on a wide window.
//   5 The connect step's notice spanned the window over a centred list.
//   6 The Ledger Accounts tab's waiting rows had no pending ring.
//   7 The sign page added 16px above Screen's standard 8px content inset.
//   8 (2026-11-16) The sign page sat bare at iPad and desktop widths: it now
//     sits in the one G126 form card (FormPage) from 600px, the failure notice
//     at the card's top and 8px from the logo below it.
// Vitest blanks CSS modules, so the layout rules are read from the CSS text.

import { readFileSync } from 'node:fs';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { WalletPicker, walletKindLabel } from '../../../packages/core/src/shared/routes/WalletPicker.jsx';
import { WalletDetails } from '../../../packages/core/src/shared/routes/WalletDetails.jsx';
import { PairSignerForm } from '../../../packages/core/src/shared/routes/PairSignerForm.jsx';
import {
    HardwareDeviceCard, hardwareModelName,
} from '../../../packages/core/src/shared/components/hardware/index.js';
import { HardwareNetworkRow } from '../../../packages/core/src/shared/components/hardware/HardwareNetworkRow.jsx';
import { makeLedgerFactory } from '../../../packages/core/src/signerFactories/ledger.js';
import { defaultRegistry } from '../../../packages/core/src/registry/index.js';
import { SEED_A, seededLedger } from '../../helpers/hwSeedDevice.js';
import pairSource from '../../../packages/core/src/shared/routes/PairSignerForm.jsx?raw';
import { HardwareSignPage } from '../../../packages/core/src/shared/components/HardwareSignPage.jsx';
import { begin, end, fail, step } from '../../../packages/core/src/signers/hardwareSession.js';

// The unit config runs from the workspace root, as the other CSS-text tests do.
const css = (path) => readFileSync(`packages/core/src/${path}`, 'utf8');
const pairCss = css('shared/routes/PairSignerForm.module.css');
const signCss = css('shared/components/HardwareSignPage.module.css');

/** The body of the first rule whose selector is exactly `selector`. */
function rule(sheet, selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, 'm').exec(sheet)?.[1] ?? '';
}

const HW = {
    id: 'hw-1', name: 'My Ledger', format: 'hardware', origin: 'connected-hardware',
    encryptedSeed: '', importedKeys: [], passphraseEnabled: false, walletMode: 'full',
    createdAt: '2026-11-15T10:00:00.000Z',
};
const SOFT = { id: 'soft-1', name: 'Everyday', format: 'bip39', origin: 'created', passphraseEnabled: false };

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('1: My Wallets names a hardware wallet by its kind', () => {
    it('labels every wallet format, and a hardware wallet as Hardware wallet, never BIP39', () => {
        expect(walletKindLabel({ format: 'hardware' })).toBe('Hardware wallet');
        expect(walletKindLabel({ format: 'counterwallet-legacy' })).toBe('Legacy');
        expect(walletKindLabel({ format: 'wif-only' })).toBe('Imported key');
        expect(walletKindLabel({ format: 'bip39' })).toBe('BIP39');
    });

    it('shows Hardware wallet on the hardware row and BIP39 on the seed row', async () => {
        const messaging = { listWallets: () => Promise.resolve([SOFT, { ...HW, accountCount: 1 }]) };
        await act(async () => {
            render(
                <MessagingProvider shell="web" messaging={messaging}>
                    <WalletPicker activeWalletId={SOFT.id} onSwitch={() => {}} onAddWallet={() => {}} onBack={() => {}} />
                </MessagingProvider>,
            );
        });
        const list = await screen.findByRole('list', { name: 'My Wallets' });
        const [soft, hw] = within(list).getAllByRole('listitem');
        expect(hw).toHaveTextContent('My Ledger');
        expect(hw).toHaveTextContent('Hardware wallet · 1 account');
        expect(hw).not.toHaveTextContent('BIP39');
        expect(soft).toHaveTextContent('BIP39');
    });
});

describe('2: a hardware wallet shows its product name, never the raw model id', () => {
    it.each([
        ['ledger', 'nanoS', 'Ledger Nano S'],
        ['ledger', 'nanoSP', 'Ledger Nano S Plus'],
        ['ledger', 'nanoX', 'Ledger Nano X'],
        ['ledger', 'stax', 'Ledger Stax'],
        ['ledger', 'flex', 'Ledger Flex'],
        ['ledger', 'europa', 'Ledger Flex'],
        ['ledger', 'apex', 'Ledger Nano Gen5'],
        ['trezor', 'T1B1', 'Trezor Model One'],
        ['trezor', '1', 'Trezor Model One'],
        ['trezor', 'One', 'Trezor Model One'],
        ['trezor', 'T2T1', 'Trezor Model T'],
        ['trezor', 'T', 'Trezor Model T'],
        ['trezor', 'T2B1', 'Trezor Safe 3'],
        ['trezor', 'T3B1', 'Trezor Safe 3'],
        ['trezor', 'Safe 3', 'Trezor Safe 3'],
        ['trezor', 'T3T1', 'Trezor Safe 5'],
        ['trezor', 'Safe 5', 'Trezor Safe 5'],
    ])('%s %s reads %s', (vendor, model, name) => {
        expect(hardwareModelName(vendor, model)).toBe(name);
    });

    it('never shows an unknown board id raw: the vendor alone, or a spelled-out name after it', () => {
        expect(hardwareModelName('ledger', 'nanoQ9')).toBe('Ledger');
        expect(hardwareModelName('trezor', 'T9Z9')).toBe('Trezor');
        expect(hardwareModelName('ledger', 'Nano X')).toBe('Ledger Nano X');
        expect(hardwareModelName('ledger', 'Ledger Nano X')).toBe('Ledger Nano X');
        expect(hardwareModelName('ledger', undefined)).toBe('Ledger');
        // A key only Object.prototype has is not a model.
        expect(hardwareModelName('ledger', 'constructor')).toBe('Ledger');
    });

    it('the device card without a name shows the product name', () => {
        render(<HardwareDeviceCard vendor="ledger" model="nanoSP" status="found" />);
        const card = document.querySelector('[data-hardware-device-card]');
        expect(card).toHaveTextContent('Ledger Nano S Plus');
        expect(card).not.toHaveTextContent('nanoSP');
    });

    it('the Details tab names the device Ledger Nano S Plus', async () => {
        const signer = { id: 'sig-1', walletId: HW.id, kind: 'ledger', vendor: 'ledger', model: 'nanoSP', deviceIdentifier: 'dev-1' };
        const messaging = {
            getSettings: () => Promise.resolve({ walletMode: 'full' }),
            listAccounts: () => Promise.resolve([{ id: 'a1', walletId: HW.id, index: 0 }]),
            listWallets: () => Promise.resolve([SOFT, HW]),
            listSigners: () => Promise.resolve([signer]),
            getSignerStatus: () => Promise.resolve({ status: 'available' }),
            getAddressesByChain: () => Promise.resolve({
                'bitcoin-mainnet': [{ address: 'bc1qaaa', derivationPath: "m/84'/0'/0'/0/0", source: 'ledger', signerId: signer.id }],
            }),
        };
        await act(async () => {
            render(
                <MessagingProvider shell="web" messaging={messaging}>
                    <WalletDetails walletId={HW.id} activeWalletId={SOFT.id} onBack={() => {}} />
                </MessagingProvider>,
            );
            for (let i = 0; i < 12; i += 1) await Promise.resolve();
        });
        fireEvent.click(screen.getByRole('tab', { name: /Details/ }));
        const facts = within(screen.getByRole('tabpanel'));
        expect(facts.getByText('Device').nextElementSibling).toHaveTextContent('Ledger Nano S Plus');
        expect(screen.queryByText(/nanoSP/)).toBeNull();
    });
});

describe('3: a waiting network uses the whole standard row', () => {
    const doge = defaultRegistry().get('dogecoin-mainnet');

    it('keeps the app guidance in the description and makes the row itself retry', () => {
        const onAdd = vi.fn();
        render(
            <ul>
                <HardwareNetworkRow descriptor={doge} title="Dogecoin" vendor="ledger" state="app" onAdd={onAdd} />
            </ul>,
        );
        const row = screen.getByRole('button', { name: /Dogecoin.*Open the Dogecoin app/ });
        expect(screen.queryByRole('button', { name: /Try Again/ })).toBeNull();
        fireEvent.click(row);
        expect(onAdd).toHaveBeenCalledTimes(1);
    });
});

describe('4: the sign page sits in the form column on a wide window', () => {
    it('caps the page body at the form column width, centred', () => {
        const body = rule(signCss, '.body');
        expect(body).toMatch(/width:\s*100%;/);
        expect(body).toMatch(/max-width:\s*var\(--xc-form-card-max-width\);/);
        expect(body).toMatch(/margin-inline:\s*auto;/);
        expect(body).toMatch(/box-sizing:\s*border-box;/);
    });

    it('uses only Screen\'s standard 8px gap below the page header', () => {
        const body = rule(signCss, '.body');
        const screenBody = rule(signCss, '.screenBody');
        expect(body).not.toMatch(/padding-block-start/);
        expect(screenBody).toMatch(/--xc-page-top:\s*var\(--xc-space-2\);/);
    });

    it('keeps the app bar edge to edge above the signing Screen', () => {
        const appBar = rule(signCss, '.appBar');
        expect(appBar).toMatch(/width:\s*100%;/);
        expect(appBar).toMatch(/flex:\s*0 0 auto;/);
    });
});

describe('8: the sign page sits in the one G126 form card from 600px', () => {
    const formCss = css('ui/FormPage.module.css');

    it('draws its content in a FormPage group, with the failure notice first', () => {
        render(<HardwareSignPage />);
        let id;
        act(() => { id = begin({ signerId: 's1', vendor: 'trezor', model: 'Safe 3', op: 'signPsbt' }); step(id, 'connected'); });
        act(() => fail(id, { kind: 'rejected' }));
        const group = screen.getByRole('group', { name: 'Sign on Trezor' });
        const alert = screen.getByRole('alert');
        expect(group.contains(alert)).toBe(true);
        expect(group.querySelector('[data-hardware-sign-page]').firstElementChild).toBe(alert);
        act(() => end(id));
    });

    it('takes FormPage\'s card: none below 600px, one centred card at the form column width from 600px', () => {
        const wide = /@media \(min-width: 600px\) \{\s*\.form \{([^}]*)\}/.exec(formCss)?.[1] ?? '';
        expect(wide).toMatch(/max-width:\s*var\(--xc-form-card-max-width\);/);
        expect(wide).toMatch(/margin:\s*0 auto;/);
        expect(wide).toMatch(/border:\s*var\(--xc-card-border\);/);
        const narrow = rule(formCss, '.form');
        expect(narrow).toMatch(/padding:\s*0;/);
        expect(narrow).not.toMatch(/border:\s*var/);
    });

    it('sizes the picture box to the logo, so the notice sits 8px above the logo', () => {
        const picture = rule(signCss, '.picture');
        expect(picture).not.toMatch(/\b(width|height):/);
    });
});

describe('5 and 6: the connect flow', () => {
    beforeEach(() => {
        Object.defineProperty(navigator, 'hid', { configurable: true, value: {} });
    });
    afterEach(() => {
        Reflect.deleteProperty(navigator, 'hid');
    });

    it('5: every step shares one centred column, so the notice lines up with the device list', () => {
        const columnRule = rule(pairCss, '.column');
        expect(columnRule).toMatch(/width:\s*100%;/);
        expect(columnRule).toMatch(/max-width:\s*var\(--xc-form-card-max-width\);/);
        expect(columnRule).toMatch(/margin-inline:\s*auto;/);
        expect(pairSource).toMatch(/<Screen variant=\{variant\} header=\{header\}>\s*<div className=\{styles\.column\} data-hardware-connect-column="">\s*\{children\}/);

        render(
            <MessagingProvider shell="web" messaging={{}}>
                <PairSignerForm mode="add" activeNetwork="mainnet" pairTrezor={vi.fn()} pairLedger={vi.fn()} onBack={() => {}} />
            </MessagingProvider>,
        );
        const column = document.querySelector('[data-hardware-connect-column]');
        expect(column).not.toBeNull();
        // The keys-stay-on-your-hardware-wallet notice and the Trezor and
        // Ledger list are both inside it.
        expect(within(column).getByText(/Your keys stay on your hardware wallet/)).toBeInTheDocument();
        expect(within(column).getByRole('button', { name: /Trezor/ })).toBeInTheDocument();
        expect(within(column).getByRole('button', { name: /Ledger/ })).toBeInTheDocument();
    });

    it('6: a Ledger network waiting for its app shows the pending ring on the Accounts tab as on Networks', async () => {
        const plugged = seededLedger(SEED_A, { openApp: 'Bitcoin' });
        const pairLedger = makeLedgerFactory({
            getTransport: async () => plugged.transport,
            getAppClass: async () => plugged.Btc,
        });
        const messaging = {
            getSettings: vi.fn().mockResolvedValue({ activeNetwork: 'mainnet', fiatCurrency: 'USD' }),
            hardwareBalances: vi.fn(async ({ items }) => items.map((item) => ({ ...item, balance: '1', fiat: 10 }))),
        };
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <PairSignerForm mode="add" activeNetwork="mainnet" pairTrezor={null} pairLedger={pairLedger} onBack={() => {}} />
            </MessagingProvider>,
        );
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /Ledger/ }));
        });
        await act(async () => {
            fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));
        });
        const networks = () => screen.getByRole('list', { name: 'Networks' });
        await waitFor(() => expect(networks().querySelector('li[data-chain-id="litecoin-mainnet"]'))
            .toHaveAttribute('data-wait', 'app'));
        const ringOf = (row) => row.querySelector('[data-supported="pending"]');
        const onNetworks = networks().querySelector('li[data-chain-id="dogecoin-mainnet"]');
        expect(ringOf(onNetworks)).toBeNull();
        expect(within(onNetworks).getByRole('button', { name: 'Try Again on Dogecoin' })).toBeTruthy();

        fireEvent.click(screen.getByRole('tab', { name: /Accounts/ }));
        const accounts = screen.getByRole('list', { name: 'Accounts found' });
        for (const chainId of ['dogecoin-mainnet', 'litecoin-mainnet']) {
            const row = accounts.querySelector(`li[data-chain-id="${chainId}"][data-wait="app"]`);
            expect(row).not.toBeNull();
            expect(ringOf(row)).toBeNull();
            expect(within(row).getByRole('button', { name: `Try Again on ${chainId.startsWith('dogecoin') ? 'Dogecoin' : 'Litecoin'}` })).toBeTruthy();
        }
        // The account row (one per account number, G131) keeps no ring.
        expect(ringOf(accounts.querySelector('li[data-account-index="0"]'))).toBeNull();
    });
});
