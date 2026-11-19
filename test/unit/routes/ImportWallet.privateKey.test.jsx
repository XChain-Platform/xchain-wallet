// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { selectOption, selectOptionValues } from '../../helpers/selectOption.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { encodeWif } from '../../../packages/core/src/crypto/wif.js';
import { defaultRegistry } from '../../../packages/core/src/registry/index.js';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ImportWallet } from '../../../packages/core/src/shared/routes/ImportWallet.jsx';

const PRIVATE_KEY_ONE = Uint8Array.from([...new Uint8Array(31), 1]);
const PASSWORD = 'correct-horse-battery';

function wif(chainId) {
    return encodeWif(PRIVATE_KEY_ONE, defaultRegistry().get(chainId).wifVersionByte);
}

function renderLane(importMnemonic = vi.fn().mockResolvedValue({})) {
    render(
        <MessagingProvider shell="web" messaging={{ importMnemonic }}>
            <ImportWallet mode="fresh" onBack={() => {}} onImported={() => {}} />
        </MessagingProvider>,
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Private key' }));
    return importMnemonic;
}

function coinField() {
    return screen.getByRole('button', { name: /^Coin: / });
}

function networkField() {
    return screen.getByRole('button', { name: /^Coin network: / });
}

function pickCoin(coin) {
    selectOption(coinField(), coin);
}

function pickNetwork(network) {
    selectOption(networkField(), network);
}

function fillRequiredWifFields(chainId) {
    fireEvent.change(screen.getByLabelText('WIF private key'), {
        target: { value: wif(chainId) },
    });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: PASSWORD } });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: PASSWORD } });
    fireEvent.click(screen.getByLabelText(
        "I understand this key isn't recoverable from a recovery phrase.",
    ));
}

afterEach(cleanup);

describe('ImportWallet private key preview', () => {
    it('orders coin, network, address type, key and address with icons', () => {
        renderLane();
        fireEvent.change(screen.getByLabelText('WIF private key'), {
            target: { value: wif('litecoin-mainnet') },
        });
        const coin = screen.getByRole('button', { name: 'Coin: Litecoin' });
        const network = screen.getByRole('button', { name: 'Coin network: Mainnet' });
        expect(screen.getByRole('button', { name: 'About Coin' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'About Coin network' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^About I understand this key/ })).toBeInTheDocument();
        const type = screen.getByLabelText('Address type');
        const key = screen.getByLabelText('WIF private key');
        const address = screen.getByLabelText('Address');
        const follows = (a, b) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
        expect(follows(coin, network)).toBe(true);
        expect(follows(network, type)).toBe(true);
        expect(follows(type, key)).toBe(true);
        expect(follows(key, address)).toBe(true);
        expect(coin.querySelector('img')).not.toBeNull();
        expect(network.querySelector('img')).not.toBeNull();
    });

    it.each([
        ['litecoin-mainnet', 'Litecoin', 'ltc1qw508d6qejxtdg4y5r3zarvary0c5xw7kgmn4n9'],
        ['dogecoin-mainnet', 'Dogecoin', 'DFpN6QqFfUm3gKNaxN6tNcab1FArL9cZLE'],
    ])('preselects %s from its WIF byte and derives its address', (chainId, coin, address) => {
        renderLane();
        fireEvent.change(screen.getByLabelText('WIF private key'), {
            target: { value: wif(chainId) },
        });

        expect(screen.getByRole('button', { name: `Coin: ${coin}` })).toBeInTheDocument();
        expect(networkField()).toHaveAccessibleName('Coin network: Mainnet');
        expect(screen.getByLabelText('Address')).toHaveValue(address);
    });

    it('uses the selected coin to infer Testnet from an ambiguous version byte', () => {
        renderLane();
        fireEvent.change(screen.getByLabelText('WIF private key'), {
            target: { value: wif('bitcoin-testnet') },
        });

        expect(coinField()).toHaveAccessibleName('Coin: Bitcoin');
        expect(networkField()).toHaveAccessibleName('Coin network: Testnet');
    });

    it('changes type choices and the live address with coin and type', () => {
        renderLane();
        fireEvent.change(screen.getByLabelText('WIF private key'), {
            target: { value: wif('bitcoin-mainnet') },
        });
        const type = screen.getByLabelText('Address type');
        expect(selectOptionValues(type)).toEqual([
            'p2pkh', 'p2sh-p2wpkh', 'p2wpkh',
        ]);
        expect(screen.getByLabelText('Address')).toHaveValue(
            'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
        );

        selectOption(type, 'p2pkh');
        expect(screen.getByLabelText('Address')).toHaveValue(
            '1BgGZ9tcN4rm9KBzDn7KprQz87SZ26SAMH',
        );

        pickCoin('dogecoin');
        expect(selectOptionValues(screen.getByLabelText('Address type')))
            .toHaveLength(1);
        expect(screen.getByLabelText('Address')).toHaveValue('');
    });

    it('lets a manual coin choice stand until the key changes', () => {
        renderLane();
        fireEvent.change(screen.getByLabelText('WIF private key'), {
            target: { value: wif('bitcoin-mainnet') },
        });
        pickCoin('litecoin');
        expect(coinField()).toHaveAccessibleName('Coin: Litecoin');

        selectOption(screen.getByLabelText('Address type'), 'p2pkh');
        expect(coinField()).toHaveAccessibleName('Coin: Litecoin');

        fireEvent.change(screen.getByLabelText('WIF private key'), {
            target: { value: wif('dogecoin-mainnet') },
        });
        expect(coinField()).toHaveAccessibleName('Coin: Dogecoin');
    });

    it.each(defaultRegistry().supportedChains()
        .filter((descriptor) => Number.isInteger(descriptor.wifVersionByte))
        .map((descriptor) => [descriptor.id, descriptor.coin, descriptor.networkKind]))(
        'maps %s from coin plus network to the existing chain id',
        async (chainId, coin, networkKind) => {
            const importMnemonic = renderLane();
            pickCoin(coin);
            pickNetwork(networkKind);
            fillRequiredWifFields(chainId);
            fireEvent.click(screen.getByRole('button', { name: 'Import' }));

            await waitFor(() => expect(importMnemonic).toHaveBeenCalledWith(expect.objectContaining({
                chainId,
            })));
        },
    );

    it('keeps address types in sync with the chosen coin and network', () => {
        renderLane();
        for (const descriptor of defaultRegistry().supportedChains()) {
            if (!Number.isInteger(descriptor.wifVersionByte)) continue;
            pickCoin(descriptor.coin);
            pickNetwork(descriptor.networkKind);
            expect(selectOptionValues(screen.getByLabelText('Address type'))).toEqual(
                descriptor.addressTypes.filter((type) => ['p2pkh', 'p2sh-p2wpkh', 'p2wpkh'].includes(type)),
            );
        }
    });

    it('shows a field error and refuses a version-byte mismatch', async () => {
        const importMnemonic = renderLane();
        fillRequiredWifFields('bitcoin-mainnet');
        pickNetwork('testnet');
        fireEvent.click(screen.getByRole('button', { name: 'Import' }));

        expect(await screen.findAllByText(/private key is for a different coin network/i)).toHaveLength(2);
        expect(networkField()).toHaveAttribute('aria-invalid', 'true');
        expect(importMnemonic).not.toHaveBeenCalled();
    });

    it('submits the selected address type', async () => {
        const importMnemonic = renderLane();
        fireEvent.change(screen.getByLabelText('WIF private key'), {
            target: { value: wif('bitcoin-mainnet') },
        });
        selectOption(screen.getByLabelText('Address type'), 'p2sh-p2wpkh');
        fireEvent.change(screen.getByLabelText('Password'), { target: { value: PASSWORD } });
        fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: PASSWORD } });
        fireEvent.click(screen.getByLabelText(
            "I understand this key isn't recoverable from a recovery phrase.",
        ));
        fireEvent.click(screen.getByRole('button', { name: 'Import' }));

        await waitFor(() => expect(importMnemonic).toHaveBeenCalledWith(expect.objectContaining({
            chainId: 'bitcoin-mainnet',
            addressType: 'p2sh-p2wpkh',
        })));
    });
});
