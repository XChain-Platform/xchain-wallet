// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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

function pickCoin(name) {
    fireEvent.click(screen.getByRole('button', { name: /^Coin network: / }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Coin network' }))
        .getByRole('button', { name: `Select ${name}` }));
}

afterEach(cleanup);

describe('ImportWallet private key preview', () => {
    it('orders the fields network, type, key, address and shows the chain icon', () => {
        renderLane();
        fireEvent.change(screen.getByLabelText('WIF private key'), {
            target: { value: wif('litecoin-mainnet') },
        });
        const network = screen.getByRole('button', { name: 'Coin network: Litecoin' });
        expect(screen.getByRole('button', { name: 'About Coin network' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^About I understand this key/ })).toBeInTheDocument();
        const type = screen.getByLabelText('Private key type');
        const key = screen.getByLabelText('WIF private key');
        const address = screen.getByLabelText('Address');
        const follows = (a, b) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
        expect(follows(network, type)).toBe(true);
        expect(follows(type, key)).toBe(true);
        expect(follows(key, address)).toBe(true);
        expect(network.querySelector('img')).not.toBeNull();

        fireEvent.click(network);
        const dialog = screen.getByRole('dialog', { name: 'Coin network' });
        expect(within(dialog).getAllByRole('button', { name: /^Select / }).map((b) => b.getAttribute('aria-label')))
            .toEqual(['Select Bitcoin', 'Select Dogecoin', 'Select Litecoin']);
        expect(dialog.querySelectorAll('img')).toHaveLength(3);
    });

    it.each([
        ['litecoin-mainnet', 'Litecoin', 'ltc1qw508d6qejxtdg4y5r3zarvary0c5xw7kgmn4n9'],
        ['dogecoin-mainnet', 'Dogecoin', 'DFpN6QqFfUm3gKNaxN6tNcab1FArL9cZLE'],
    ])('preselects %s from its WIF byte and derives its address', (chainId, coin, address) => {
        renderLane();
        fireEvent.change(screen.getByLabelText('WIF private key'), {
            target: { value: wif(chainId) },
        });

        expect(screen.getByRole('button', { name: `Coin network: ${coin}` })).toBeInTheDocument();
        expect(screen.getByLabelText('Address')).toHaveValue(address);
    });

    it('changes type choices and the live address with coin and type', () => {
        renderLane();
        fireEvent.change(screen.getByLabelText('WIF private key'), {
            target: { value: wif('bitcoin-mainnet') },
        });
        const type = screen.getByLabelText('Private key type');
        expect(within(type).getAllByRole('option').map((option) => option.value)).toEqual([
            'p2pkh', 'p2sh-p2wpkh', 'p2wpkh',
        ]);
        expect(screen.getByLabelText('Address')).toHaveValue(
            'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
        );

        fireEvent.change(type, { target: { value: 'p2pkh' } });
        expect(screen.getByLabelText('Address')).toHaveValue(
            '1BgGZ9tcN4rm9KBzDn7KprQz87SZ26SAMH',
        );

        pickCoin('Dogecoin');
        expect(within(screen.getByLabelText('Private key type')).getAllByRole('option'))
            .toHaveLength(1);
        expect(screen.getByLabelText('Address')).toHaveValue('');
    });

    it('lets a manual coin choice stand until the key changes', () => {
        renderLane();
        fireEvent.change(screen.getByLabelText('WIF private key'), {
            target: { value: wif('bitcoin-mainnet') },
        });
        pickCoin('Litecoin');
        expect(screen.getByRole('button', { name: 'Coin network: Litecoin' })).toBeInTheDocument();

        fireEvent.change(screen.getByLabelText('Private key type'), { target: { value: 'p2pkh' } });
        expect(screen.getByRole('button', { name: 'Coin network: Litecoin' })).toBeInTheDocument();

        fireEvent.change(screen.getByLabelText('WIF private key'), {
            target: { value: wif('dogecoin-mainnet') },
        });
        expect(screen.getByRole('button', { name: 'Coin network: Dogecoin' })).toBeInTheDocument();
    });

    it('submits the selected address type', async () => {
        const importMnemonic = renderLane();
        fireEvent.change(screen.getByLabelText('WIF private key'), {
            target: { value: wif('bitcoin-mainnet') },
        });
        fireEvent.change(screen.getByLabelText('Private key type'), {
            target: { value: 'p2sh-p2wpkh' },
        });
        fireEvent.change(screen.getByLabelText('Password'), { target: { value: PASSWORD } });
        fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: PASSWORD } });
        fireEvent.click(screen.getByLabelText(
            "I understand this key isn't recoverable from a recovery phrase.",
        ));
        fireEvent.click(screen.getByRole('button', { name: 'Import' }));

        expect(importMnemonic).toHaveBeenCalledWith(expect.objectContaining({
            chainId: 'bitcoin-mainnet',
            addressType: 'p2sh-p2wpkh',
        }));
    });
});
