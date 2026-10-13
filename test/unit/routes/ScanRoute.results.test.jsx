// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ScanRoute } from '../../../packages/core/src/shared/routes/ScanRoute.jsx';
import { encodeXcwChunks } from '../../../packages/core/src/uri/psbtQr.js';

const scanner = vi.hoisted(() => ({ onFrame: null }));

vi.mock('@xchain-wallet/core/ui', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        QrScanner: ({ onFrame }) => {
            scanner.onFrame = onFrame;
            return null;
        },
    };
});

const RAW_TRANSACTION = '0200000001'
    + '00'.repeat(32)
    + '00000000'
    + '00'
    + 'ffffffff'
    + '01'
    + '0100000000000000'
    + '00'
    + '00000000';

const MULTI_FRAME_CHUNK = encodeXcwChunks(new Uint8Array(400).fill(65))[0];
const BTC = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
const LTC = 'ltc1qw508d6qejxtdg4y5r3zarvary0c5xw7kgmn4n9';
const DOGE = 'DH5yaieqoZN36fDVciNyRueRGvGLR3mr7L';

const ROUTING_CASES = [
    {
        name: 'BIP21 URI with its standard fields',
        input: `bitcoin:${BTC}?amount=0.25&label=Coffee%20shop&message=Order%2042`,
        outcome: {
            kind: 'send',
            address: BTC,
            amount: '0.25',
            memo: 'Order 42',
            chainId: 'bitcoin-mainnet',
        },
    },
    {
        name: 'Litecoin URI',
        input: `litecoin:${LTC}?amount=1.5`,
        outcome: { kind: 'send', address: LTC, amount: '1.5', chainId: 'litecoin-mainnet' },
    },
    {
        name: 'Dogecoin URI',
        input: `dogecoin:${DOGE}?amount=12`,
        outcome: { kind: 'send', address: DOGE, amount: '12', chainId: 'dogecoin-mainnet' },
    },
    {
        name: 'plain address',
        input: BTC,
        outcome: { kind: 'send', address: BTC, chainId: 'bitcoin-mainnet' },
    },
    {
        name: 'uppercase bech32 address',
        input: BTC.toUpperCase(),
        outcome: { kind: 'send', address: BTC.toUpperCase(), chainId: 'bitcoin-mainnet' },
    },
    {
        name: 'legacy xchain send URI',
        input: `xchain://bitcoin-mainnet/BTC?amount=2&to=${BTC}`,
        outcome: {
            kind: 'send',
            address: BTC,
            amount: '2',
            tick: 'BTC',
            chainId: 'bitcoin-mainnet',
        },
    },
    {
        name: 'coin-code xchain send URI with the default registry',
        input: `xchain:BTC/send?to=${BTC}&amount=3&tick=XCP&memo=Invoice`,
        outcome: {
            kind: 'send',
            address: BTC,
            amount: '3',
            tick: 'XCP',
            memo: 'Invoice',
            chainId: 'bitcoin-mainnet',
        },
    },
    {
        name: 'BIP21-style xchain URI',
        input: `xchain:${LTC}?amount=4&tick=LTC`,
        outcome: {
            kind: 'send',
            address: LTC,
            amount: '4',
            tick: 'LTC',
            chainId: 'litecoin-mainnet',
        },
    },
    {
        name: 'xchain receive URI',
        input: 'xchain://bitcoin-mainnet/BTC?kind=receive',
        outcome: { kind: 'receive' },
    },
    {
        name: 'PSBT hex',
        input: '70736274ff01000000',
        outcome: { kind: 'psbt', psbtHex: '70736274ff01000000' },
    },
];

const EXPLANATION_CASES = [
    {
        name: 'payment URI whose address belongs to another chain',
        input: `bitcoin:${LTC}?amount=1`,
        message: /payment request.*supported chain or valid address.*check the request.*paste the address instead/i,
    },
    {
        name: 'payment URI whose chain parameter contradicts its scheme',
        input: `bitcoin:${BTC}?chain=litecoin-mainnet`,
        message: /payment request.*supported chain or valid address.*check the request.*paste the address instead/i,
    },
    {
        name: 'xchain payment whose address contradicts its chain',
        input: `xchain:LTC/send?to=${BTC}&amount=1`,
        message: /payment request.*supported chain or valid address.*check the request.*paste the address instead/i,
    },
    {
        name: 'unsupported required BIP21 parameter',
        input: `bitcoin:${BTC}?req-something=1`,
        message: /payment request.*supported chain or valid address.*check the request.*paste the address instead/i,
    },
    {
        name: 'address-shaped garbage',
        input: 'thisisnotavalidwalletaddress12345',
        message: /contains text the wallet doesn't know how to use.*scan a supported.*paste it below instead/i,
    },
    {
        name: 'signed transaction hex',
        input: RAW_TRANSACTION,
        message: /signed transaction.*can't broadcast raw transaction hex/i,
    },
    {
        name: 'backup pointer',
        input: 'xchain-backup:1?loc=https%3A%2F%2Fexample.com%2Fwallet&name=Cold',
        message: /backup pointer.*Import wallet.*Encrypted backup/i,
    },
    {
        name: 'pairing code',
        input: 'XCW-PAIR:ZmFrZS1wYWlyaW5nLWNvZGU',
        message: /wallet pairing code.*Pair a watcher or signer/i,
    },
    {
        name: 'multi-frame QR chunk',
        input: MULTI_FRAME_CHUNK,
        message: /part 1 of 3.*screen that asked for this code.*every frame/i,
    },
    {
        name: 'private key',
        input: 'KwXGs3HkgjKA5exN3UiMQtGQakRrJ9zysFDa4rY4dcEdqeerF1tF',
        message: /private key.*Import Wallet.*Import WIF/i,
    },
    {
        name: 'recovery phrase',
        input: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
        message: /recovery phrase.*Import Wallet.*Recovery phrase/i,
    },
    {
        name: 'unknown text',
        input: 'hello from an unrelated QR code',
        message: /contains text the wallet doesn't know how to use.*scan a supported.*paste it below instead/i,
    },
    {
        name: 'unsupported URI',
        input: 'https://example.com/not-a-payment',
        message: /contains text the wallet doesn't know how to use.*scan a supported.*paste it below instead/i,
    },
];

function submit(input, onClassified = vi.fn()) {
    render(<ScanRoute onClassified={onClassified} onBack={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Or paste it here'), { target: { value: input } });
    fireEvent.click(screen.getByRole('button', { name: 'Use pasted text' }));
    return onClassified;
}

afterEach(() => cleanup());

describe('ScanRoute classified results', () => {
    it('applies only the first result when two frames arrive before rerender', () => {
        const onClassified = vi.fn();
        render(<ScanRoute onClassified={onClassified} onBack={vi.fn()} />);

        act(() => {
            scanner.onFrame(BTC);
            scanner.onFrame(LTC);
        });

        expect(onClassified).toHaveBeenCalledOnce();
        expect(onClassified).toHaveBeenCalledWith(expect.objectContaining({ address: BTC }));
    });

    it.each(ROUTING_CASES)('routes $name to its destination', ({ input, outcome }) => {
        const onClassified = submit(input);
        expect(onClassified).toHaveBeenCalledOnce();
        expect(onClassified).toHaveBeenCalledWith(expect.objectContaining(outcome));
    });

    it.each(EXPLANATION_CASES)('explains $name in plain words', ({ input, message }) => {
        const onClassified = submit(input);
        expect(onClassified).not.toHaveBeenCalled();
        expect(screen.getByRole('alert')).toHaveTextContent(message);
        expect(screen.getByRole('alert')).not.toHaveTextContent(/unknown|transaction-hex|backup-pointer|pairing-code/i);
    });
});
