// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ScanRoute } from '../../../packages/core/src/shared/routes/ScanRoute.jsx';
import { encodeXcwChunks } from '../../../packages/core/src/uri/psbtQr.js';

vi.mock('@xchain-wallet/core/ui', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, QrScanner: () => null };
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

const ROUTING_CASES = [
    {
        name: 'Bitcoin URI',
        input: 'bitcoin:bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq?amount=0.25',
        outcome: { kind: 'send', address: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq', amount: '0.25' },
    },
    {
        name: 'Litecoin URI',
        input: 'litecoin:ltc1qg82wtl0pm3m7p4f9l7sn2p8hx5k3h5y0n0l8m9?amount=1.5',
        outcome: { kind: 'send', address: 'ltc1qg82wtl0pm3m7p4f9l7sn2p8hx5k3h5y0n0l8m9', amount: '1.5' },
    },
    {
        name: 'Dogecoin URI',
        input: 'dogecoin:DH5yaieqoZN36fDVciNyRueRGvGLR3mr7L?amount=12',
        outcome: { kind: 'send', address: 'DH5yaieqoZN36fDVciNyRueRGvGLR3mr7L', amount: '12' },
    },
    {
        name: 'plain address',
        input: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
        outcome: { kind: 'send', address: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh' },
    },
    {
        name: 'xchain send URI',
        input: 'xchain://bitcoin-mainnet/BTC?amount=2&to=bc1qexample',
        outcome: {
            kind: 'send',
            address: 'bc1qexample',
            amount: '2',
            tick: 'BTC',
            chainId: 'bitcoin-mainnet',
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
        name: 'signed transaction hex',
        input: RAW_TRANSACTION,
        message: /signed transaction.*cannot broadcast raw transaction hex/i,
    },
    {
        name: 'backup pointer',
        input: 'xchain-backup:1?loc=https%3A%2F%2Fexample.com%2Fwallet&name=Cold',
        message: /backup pointer.*Import Wallet.*Restore from backup/i,
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
        message: /contains text the wallet does not know how to use/i,
    },
    {
        name: 'unsupported URI',
        input: 'https://example.com/not-a-payment',
        message: /contains text the wallet does not know how to use/i,
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
