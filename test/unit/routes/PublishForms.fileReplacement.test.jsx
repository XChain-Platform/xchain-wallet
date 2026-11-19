// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { typeCustomRate } from '../../helpers/customNetworkFee.js';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { AttachContentForm } from '../../../packages/core/src/shared/routes/AttachContentForm.jsx';
import { GatedPublishForm } from '../../../packages/core/src/shared/routes/GatedPublishForm.jsx';
import { PublishFileForm } from '../../../packages/core/src/shared/routes/PublishFileForm.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';
import { publishWalletModes, resetWalletModes } from '../../../packages/core/src/shared/hooks/useWalletMode.js';
import { maxPublicFileBytes } from '../../../packages/core/src/flows/fileSizeLimits.js';
import { formatBytes } from '../../../packages/core/src/shared/utils/formatBytes.js';

const CHAIN = 'bitcoin-regtest';
const SOURCE = {
    id: 'addr-1',
    address: 'bc1qdevmock02aa',
    publicKey: '02aa',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
};

let readers;
let originalFileReader;

class ControlledFileReader {
    constructor() {
        this.result = null;
        readers.push(this);
    }

    readAsArrayBuffer() {}

    succeed(bytes = 2) {
        this.result = new ArrayBuffer(bytes);
        this.onload?.();
    }

    fail() {
        this.onerror?.(new Error('read failed'));
    }
}

function messaging() {
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [SOURCE] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: SOURCE }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        listGatedKeys: vi.fn().mockResolvedValue([]),
        getTokenInfo: vi.fn().mockResolvedValue({ creator: SOURCE.address, divisibility: 8 }),
        getGenesisForToken: vi.fn().mockResolvedValue({ action_index: 7 }),
    };
    return new Proxy(target, {
        get(object, property) {
            if (property in object) return object[property];
            return vi.fn().mockResolvedValue([]);
        },
    });
}

function mount(ui, client = messaging()) {
    return render(<MessagingProvider shell="web" messaging={client}>{ui}</MessagingProvider>);
}

// The forms sit on the Wallet Form Standard frame: Memo, Access and the
// Network fee are closed sections, opened before a field inside is used.
async function openSection(title) {
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(`^${title}\\b`), expanded: false }));
}

beforeEach(() => {
    readers = [];
    originalFileReader = globalThis.FileReader;
    globalThis.FileReader = ControlledFileReader;
});

afterEach(() => {
    cleanup();
    resetWalletModes();
    __clearTokenInfoCache();
    globalThis.FileReader = originalFileReader;
});

describe('publish forms replace file state safely', () => {
    it('refuses gated publishing before review when the issuer is unknown', async () => {
        const client = messaging();
        client.getTokenInfo = vi.fn().mockResolvedValue({ chainId: CHAIN, tick: 'GATE', loadError: true });
        mount(
            <GatedPublishForm walletId="w" chainId={CHAIN} tick="GATE" issuerAddress={null} onBack={() => {}} />,
            client,
        );

        // The owner read settles after mount, so the wait is on the text.
        await waitFor(() => expect(screen.getAllByText("The token's issuer could not be confirmed, so this action is not available. Try again when the explorer answers.").length).toBeGreaterThan(0));
        // G130: the button keeps its colour and a tap is refused at the top.
        expect(screen.getByRole('button', { name: 'Publish File' })).toBeEnabled();
        expect(client.buildActionPsbtRequest).not.toHaveBeenCalled();
    });

    it('exposes gated metadata through the shared field roles and counters', async () => {
        mount(<GatedPublishForm walletId="w" chainId={CHAIN} tick="GATE" issuerAddress={SOURCE.address} onBack={() => {}} />);

        await screen.findByLabelText('File to publish');
        const title = await screen.findByRole('textbox', { name: 'Title' });
        await openSection('Memo');
        const memo = screen.getByRole('textbox', { name: 'Memo' });
        fireEvent.change(title, { target: { value: 'Member brief' } });
        fireEvent.change(memo, { target: { value: 'October' } });

        expect(title).toHaveValue('Member brief');
        expect(memo).toHaveValue('October');
        fireEvent.click(screen.getByRole('button', { name: /^About File \(up to / }));
        expect(screen.getByRole('tooltip'))
            .toHaveTextContent(/Publish a file that only holders of GATE can read/);
        expect(screen.getByText('12 / 120')).toBeInTheDocument();
        expect(screen.getByText('7 / 250')).toBeInTheDocument();
    });

    it('refuses hostile gated metadata before review', async () => {
        mount(<GatedPublishForm walletId="w" chainId={CHAIN} tick="GATE" issuerAddress={SOURCE.address} onBack={() => {}} />);
        fireEvent.change(await screen.findByLabelText('File to publish'), {
            target: { files: [new File(['ok'], 'member.txt', { type: 'text/plain' })] },
        });
        await act(async () => readers[0].succeed());
        await waitFor(() => expect(document.body.textContent).toContain('member.txt'));
        fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), {
            target: { value: 'safe\u202eunsafe' },
        });

        fireEvent.click(screen.getByRole('button', { name: 'Publish File' }));

        expect(await screen.findByRole('alert'))
            .toHaveTextContent('Title cannot contain text-direction control characters.');
        expect(screen.queryByRole('button', { name: 'Reject' })).toBeNull();
    });

    it('keeps the public network picker free of network-kind text', async () => {
        mount(<PublishFileForm walletId="w" onBack={() => {}} />);

        // Network sits in the closed From section.
        await screen.findByRole('button', { name: /^Network: Bitcoin/, hidden: true });
        expect(document.body).not.toHaveTextContent(/regtest|testnet|Not mainnet/i);
    });

    it.each([
        ['public publish', () => mount(<PublishFileForm walletId="w" onBack={() => {}} />), 'File to publish', "Couldn't read that file."],
        ['gated publish', () => mount(<GatedPublishForm walletId="w" chainId={CHAIN} tick="GATE" issuerAddress={SOURCE.address} onBack={() => {}} />), 'File to publish', 'Could not read that file.'],
        ['artwork attachment', () => mount(<AttachContentForm walletId="w" chainId={CHAIN} tick="ART" issuerAddress={SOURCE.address} onBack={() => {}} />), 'Choose file to attach', 'Could not read that file.'],
    ])('clears the previous file when a replacement read fails in %s', async (_name, mountRoute, inputLabel, unreadableMessage) => {
        mountRoute();
        const input = await screen.findByLabelText(inputLabel);
        fireEvent.change(input, {
            target: { files: [new File(['ok'], 'old.txt', { type: 'text/plain' })] },
        });
        await act(async () => readers[0].succeed());
        await waitFor(() => expect(document.body.textContent).toContain('old.txt'));

        fireEvent.change(input, {
            target: { files: [new File(['new'], 'replacement.txt', { type: 'text/plain' })] },
        });
        expect(document.body.textContent).not.toContain('old.txt');
        await act(async () => readers[1].fail());

        expect(await screen.findByRole('alert')).toHaveTextContent(unreadableMessage);
        expect(document.body.textContent).not.toContain('old.txt');
    });

    it('rejects an empty gated file instead of advancing it to review', async () => {
        mount(
            <GatedPublishForm
                walletId="w"
                chainId={CHAIN}
                tick="GATE"
                issuerAddress={SOURCE.address}
                onBack={() => {}}
            />,
        );
        const input = await screen.findByLabelText('File to publish');
        fireEvent.change(input, {
            target: { files: [new File([], 'empty.txt', { type: 'text/plain' })] },
        });

        await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('That file is empty.'));
        expect(readers).toHaveLength(0);
    });

    it.each([
        ['public publish', () => mount(<PublishFileForm walletId="w" onBack={() => {}} />), 'File to publish'],
        ['gated publish', () => mount(<GatedPublishForm walletId="w" chainId={CHAIN} tick="GATE" issuerAddress={SOURCE.address} onBack={() => {}} />), 'File to publish'],
        ['artwork attachment', () => mount(<AttachContentForm walletId="w" chainId={CHAIN} tick="ART" issuerAddress={SOURCE.address} onBack={() => {}} />), 'Choose file to attach'],
    ])('refuses a hostile file name before reading or rendering it in %s', async (_name, mountRoute, inputLabel) => {
        mountRoute();
        fireEvent.change(await screen.findByLabelText(inputLabel), {
            target: { files: [new File(['bad'], 'safe\u202eunsafe.txt', { type: 'text/plain' })] },
        });

        expect(await screen.findByRole('alert'))
            .toHaveTextContent('File name cannot contain text-direction control characters.');
        expect(readers).toHaveLength(0);
        expect(document.body.textContent).not.toContain('safe\u202eunsafe.txt');
    });

    it.each([
        ['public publish', () => mount(<PublishFileForm walletId="w" onBack={() => {}} />), 'File to publish'],
        ['gated publish', () => mount(<GatedPublishForm walletId="w" chainId={CHAIN} tick="GATE" issuerAddress={SOURCE.address} onBack={() => {}} />), 'File to publish'],
        ['artwork attachment', () => mount(<AttachContentForm walletId="w" chainId={CHAIN} tick="ART" issuerAddress={SOURCE.address} onBack={() => {}} />), 'Choose file to attach'],
    ])('rejects malformed MIME metadata before reading in %s', async (_name, mountRoute, inputLabel) => {
        mountRoute();
        const input = await screen.findByLabelText(inputLabel);
        fireEvent.change(input, {
            target: { files: [new File(['bad'], 'bad.bin', { type: 'image/png;payload' })] },
        });

        expect(await screen.findByRole('alert')).toHaveTextContent('invalid content type');
        expect(readers).toHaveLength(0);
    });

    it('rejects a non-artwork file type before reading it', async () => {
        mount(<AttachContentForm walletId="w" chainId={CHAIN} tick="ART" issuerAddress={SOURCE.address} onBack={() => {}} />);
        const input = await screen.findByLabelText('Choose file to attach');
        fireEvent.change(input, {
            target: { files: [new File(['%PDF'], 'document.pdf', { type: 'application/pdf' })] },
        });

        expect(await screen.findByRole('alert')).toHaveTextContent('not accepted for artwork');
        expect(readers).toHaveLength(0);
    });

    it('ignores a stale public-file read that finishes after its replacement', async () => {
        mount(<PublishFileForm walletId="w" onBack={() => {}} />);
        const input = await screen.findByLabelText('File to publish');
        fireEvent.change(input, {
            target: { files: [new File(['old'], 'old.txt', { type: 'text/plain' })] },
        });
        fireEvent.change(input, {
            target: { files: [new File(['new'], 'new.txt', { type: 'text/plain' })] },
        });

        await act(async () => readers[1].succeed(3));
        await waitFor(() => expect(document.body.textContent).toContain('new.txt'));
        await act(async () => readers[0].succeed(3));

        expect(document.body.textContent).toContain('new.txt');
        expect(document.body.textContent).not.toContain('old.txt');
    });

    it('uses the encoding-aware attachment cap and rechecks it after metadata edits', async () => {
        // A hardware From cannot sign the Taproot upload reveal, so Standard is
        // the only Upload method and its legacy ceiling is the one rechecked.
        // (With the envelope available, a title that outgrows Standard moves the
        // upload onto the envelope instead of refusing it.)
        const client = messaging();
        const device = { ...SOURCE, source: 'ledger' };
        client.getAddressesByChain.mockResolvedValue({ [CHAIN]: [device] });
        client.getActiveAddresses.mockResolvedValue({ [CHAIN]: device });
        mount(<AttachContentForm walletId="w" chainId={CHAIN} tick="ART" issuerAddress={SOURCE.address} onBack={() => {}} />, client);
        const input = await screen.findByLabelText('Choose file to attach');
        // The field names the Standard ceiling, the one this source can sign.
        const legacyLabel = `Artwork file (up to ${formatBytes(
            maxPublicFileBytes({ name: 'file', type: 'application/octet-stream', title: '', memo: '' }),
            { limit: true },
        )})`;
        await waitFor(() => expect(document.body.textContent).toContain(legacyLabel));
        const file = new File([new Uint8Array(8_080)], 'art.txt', { type: 'text/plain' });
        fireEvent.change(input, { target: { files: [file] } });
        await act(async () => readers[0].succeed(8_080));
        await waitFor(() => expect(document.body.textContent).toContain('art.txt'));

        fireEvent.change(screen.getByLabelText('Title'), {
            target: { value: 'x'.repeat(100) },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Attach Artwork' }));

        expect(await screen.findByRole('alert')).toHaveTextContent('Shorten the title or memo');
    });

    it('distinguishes a gated pack lookup failure from an empty pack list', async () => {
        const client = messaging();
        client.listGatedKeys.mockRejectedValue(new Error('offline'));
        mount(
            <GatedPublishForm
                walletId="w"
                chainId={CHAIN}
                tick="GATE"
                issuerAddress={SOURCE.address}
                onBack={() => {}}
            />,
            client,
        );

        expect(await screen.findByRole('alert')).toHaveTextContent('Could not load reusable packs');
        expect(document.body.textContent).not.toContain('No reusable packs');
    });

    it('sends gated publish straight to the confirm compose and keeps the form when it fails', async () => {
        const client = messaging();
        client.composeGatedPublishForConfirm = vi.fn().mockRejectedValue(new Error('Encoder offline'));
        mount(<GatedPublishForm walletId="w" chainId={CHAIN} tick="GATE" issuerAddress={SOURCE.address} onBack={() => {}} />, client);
        const input = await screen.findByLabelText('File to publish');
        fireEvent.change(input, {
            target: { files: [new File(['draft'], 'members.txt', { type: 'text/plain' })] },
        });
        await act(async () => readers[0].succeed(5));
        fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), {
            target: { value: 'Member draft' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Publish File' }));

        expect(await screen.findByRole('alert')).toBeInTheDocument();
        expect(client.composeGatedPublishForConfirm).toHaveBeenCalledTimes(1);
        expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('Member draft');
        expect(screen.getByText(/members\.txt/)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Sign and Publish|Sign on / })).toBeNull();
        expect(screen.queryByLabelText('Password')).toBeNull();
    });

    it('builds the unsigned gated publish straight from the watcher form with no confirm step', async () => {
        const client = messaging();
        client.getSettings.mockResolvedValue({ walletMode: 'watcher' });
        // A wallet's mode comes from the wallet-mode store, not settings.
        publishWalletModes({ wallets: [{ id: 'w', walletMode: 'watcher' }], activeWalletId: 'w' });
        client.buildGatedPublishPsbtRequest = vi.fn().mockResolvedValue({ psbtHex: '70736274ff' });
        client.composeGatedPublishForConfirm = vi.fn();
        mount(<GatedPublishForm walletId="w" chainId={CHAIN} tick="GATE" issuerAddress={SOURCE.address} onBack={() => {}} />, client);
        const input = await screen.findByLabelText('File to publish');
        fireEvent.change(input, {
            target: { files: [new File(['abc'], 'members.txt', { type: 'text/plain' })] },
        });
        await act(async () => readers[0].succeed(3));
        fireEvent.click(await screen.findByRole('button', { name: /^Create Transaction for Signing$/i }));

        await waitFor(() => expect(client.buildGatedPublishPsbtRequest).toHaveBeenCalledTimes(1));
        expect(client.composeGatedPublishForConfirm).not.toHaveBeenCalled();
        expect(screen.queryByRole('button', { name: 'Reject' })).toBeNull();
    });

    it('returns from artwork review without resubmitting and preserves the form', async () => {
        mount(<AttachContentForm walletId="w" chainId={CHAIN} tick="ART" issuerAddress={SOURCE.address} onBack={() => {}} />);
        const input = await screen.findByLabelText('Choose file to attach');
        fireEvent.change(input, {
            target: { files: [new File(['art'], 'cover.txt', { type: 'text/plain' })] },
        });
        await act(async () => readers[0].succeed(3));
        fireEvent.change(screen.getByLabelText('Title'), {
            target: { value: 'Cover art' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Attach Artwork' }));

        expect(fireEvent.click(await screen.findByRole('button', { name: 'Back' }))).toBe(false);
        expect(await screen.findByLabelText('Title')).toHaveValue('Cover art');
        expect(screen.getByText('cover.txt')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
    });

    it('shows the exact public metadata that will be built and keeps it after Back', async () => {
        const client = messaging();
        client.getSettings.mockResolvedValue({ walletMode: 'watcher' });
        // A wallet's mode comes from the wallet-mode store, not settings.
        publishWalletModes({ wallets: [{ id: 'w', walletMode: 'watcher' }], activeWalletId: 'w' });
        mount(<PublishFileForm walletId="w" onBack={() => {}} />, client);

        const input = await screen.findByLabelText('File to publish');
        fireEvent.change(input, {
            target: { files: [new File(['abc'], ' report.txt ', { type: 'text/plain' })] },
        });
        await act(async () => readers[0].succeed(3));
        fireEvent.change(screen.getByLabelText('Title'), {
            target: { value: '  Quarterly report  ' },
        });
        await openSection('Memo');
        fireEvent.change(screen.getByLabelText('Memo'), {
            target: { value: ' keep these spaces ' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Publish File' }));

        // Sizes read in KB, never bytes; a 3-byte file reads as the 0.1 KB floor.
        expect(await screen.findByText('report.txt · 0.1 KB · text/plain')).toBeInTheDocument();
        expect(screen.getByText('Quarterly report')).toBeInTheDocument();
        expect(screen.getByText((_, element) => (
            element?.tagName === 'DD' && element.textContent === ' keep these spaces '
        ))).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Back' }));
        expect(await screen.findByLabelText('Title')).toHaveValue('  Quarterly report  ');
        expect(screen.getByLabelText('Memo')).toHaveValue(' keep these spaces ');
        expect(document.body.textContent).toContain(' report.txt ');
    });

    it('composes the exact gated metadata and full existing pack hash for the confirm screen', async () => {
        const client = messaging();
        const keyHash = 'ab'.repeat(32);
        client.listGatedKeys.mockResolvedValue([{ keyHash }]);
        client.composeGatedPublishForConfirm = vi.fn().mockRejectedValue(new Error('Encoder offline'));
        mount(
            <GatedPublishForm
                walletId="w"
                chainId={CHAIN}
                tick="GATE"
                issuerAddress={SOURCE.address}
                onBack={() => {}}
            />,
            client,
        );
        const input = await screen.findByLabelText('File to publish');
        fireEvent.change(input, {
            target: { files: [new File(['abc'], ' gated.txt ', { type: 'text/plain' })] },
        });
        await act(async () => readers[0].succeed(3));
        fireEvent.change(screen.getByLabelText('Title'), { target: { value: '  Members  ' } });
        await openSection('Memo');
        fireEvent.change(screen.getByLabelText('Memo'), { target: { value: '  October  ' } });
        await openSection('Access');
        // Pack is the themed dropdown (G119): open it, pick the existing pack.
        fireEvent.click(await screen.findByRole('button', { name: 'Pack: New pack (fresh key)' }));
        fireEvent.click(screen.getByRole('option', { name: new RegExp(keyHash.slice(0, 12)) }));
        fireEvent.click(screen.getByRole('button', { name: 'Publish File' }));

        await waitFor(() => expect(client.composeGatedPublishForConfirm).toHaveBeenCalledTimes(1));
        expect(client.composeGatedPublishForConfirm).toHaveBeenCalledWith(expect.objectContaining({
            gateTicker: 'GATE',
            type: 'text/plain',
            title: 'Members',
            memo: 'October',
            existingKeyHash: keyHash,
        }));
        expect(await screen.findByRole('alert')).toBeInTheDocument();
        expect(screen.getByLabelText('Title')).toHaveValue('  Members  ');
        expect(screen.getByLabelText('Memo')).toHaveValue('  October  ');
    });

    // Typed into the one custom fee editor, the Network fee line (G113).
    it.each([
        ['', 'Enter a custom network fee.'],
        ['50000', 'Enter a rate no higher than 1,000 sat/vB.'],
    ])('refuses the public custom fee %j before review', async (rate, message) => {
        const client = messaging();
        client.getSettings.mockResolvedValue({ walletMode: 'watcher' });
        // A wallet's mode comes from the wallet-mode store, not settings.
        publishWalletModes({ wallets: [{ id: 'w', walletMode: 'watcher' }], activeWalletId: 'w' });
        mount(<PublishFileForm walletId="w" onBack={() => {}} />, client);
        const input = await screen.findByLabelText('File to publish');
        fireEvent.change(input, {
            target: { files: [new File(['abc'], 'report.txt', { type: 'text/plain' })] },
        });
        await act(async () => readers[0].succeed(3));
        await openSection('Speed and Fees');
        await typeCustomRate(rate);
        fireEvent.click(screen.getByRole('button', { name: 'Publish File' }));

        expect(await screen.findByText(message)).toBeInTheDocument();
        expect(client.buildActionPsbtRequest).not.toHaveBeenCalled();
    });

    it('refuses an overlong public memo before review', async () => {
        const client = messaging();
        client.getSettings.mockResolvedValue({ walletMode: 'watcher' });
        // A wallet's mode comes from the wallet-mode store, not settings.
        publishWalletModes({ wallets: [{ id: 'w', walletMode: 'watcher' }], activeWalletId: 'w' });
        mount(<PublishFileForm walletId="w" onBack={() => {}} />, client);
        const input = await screen.findByLabelText('File to publish');
        fireEvent.change(input, {
            target: { files: [new File(['abc'], 'report.txt', { type: 'text/plain' })] },
        });
        await act(async () => readers[0].succeed(3));
        await openSection('Memo');
        fireEvent.change(screen.getByLabelText('Memo'), {
            target: { value: 'm'.repeat(251) },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Publish File' }));

        expect(await screen.findByRole('alert')).toHaveTextContent('network accepts at most 250 characters');
        expect(client.buildActionPsbtRequest).not.toHaveBeenCalled();
    });

    it('refuses stale gated ownership before review', async () => {
        const client = messaging();
        client.getTokenInfo.mockResolvedValue({ creator: 'another-owner', divisibility: 8 });
        client.composeGatedPublishForConfirm = vi.fn();
        mount(
            <GatedPublishForm
                walletId="w"
                chainId={CHAIN}
                tick="GATE"
                issuerAddress={SOURCE.address}
                onBack={() => {}}
            />,
            client,
        );
        const input = await screen.findByLabelText('File to publish');
        fireEvent.change(input, {
            target: { files: [new File(['abc'], 'gated.txt', { type: 'text/plain' })] },
        });
        await act(async () => readers[0].succeed(3));
        fireEvent.click(screen.getByRole('button', { name: 'Publish File' }));

        expect(await screen.findByRole('alert')).toHaveTextContent('no longer owns GATE');
        expect(client.composeGatedPublishForConfirm).not.toHaveBeenCalled();
    });

    it('refuses gated memo and fee errors before review', async () => {
        const client = messaging();
        mount(
            <GatedPublishForm
                walletId="w"
                chainId={CHAIN}
                tick="GATE"
                issuerAddress={SOURCE.address}
                onBack={() => {}}
            />,
            client,
        );
        const input = await screen.findByLabelText('File to publish');
        fireEvent.change(input, {
            target: { files: [new File(['abc'], 'gated.txt', { type: 'text/plain' })] },
        });
        await act(async () => readers[0].succeed(3));
        await openSection('Memo');
        fireEvent.change(screen.getByLabelText('Memo'), {
            target: { value: '😀'.repeat(126) },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Publish File' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('network accepts at most 250 characters');

        fireEvent.change(screen.getByLabelText('Memo'), { target: { value: '' } });
        await openSection('Speed and Fees');
        await typeCustomRate('0');
        fireEvent.click(screen.getByRole('button', { name: 'Publish File' }));
        expect(await screen.findAllByText(/must be greater than zero/)).not.toHaveLength(0);
        expect(client.getTokenInfo).not.toHaveBeenCalled();
    });

    it('uses fresh token divisibility when validating an unlock threshold', async () => {
        const testnet = 'bitcoin-testnet';
        const client = messaging();
        client.getAddressesByChain.mockResolvedValue({ [testnet]: [SOURCE] });
        client.getTokenInfo.mockResolvedValue({ creator: SOURCE.address, divisibility: 2 });
        client.getIndexerWatermark = vi.fn().mockResolvedValue({ watermark: 5 });
        mount(
            <GatedPublishForm
                walletId="w"
                chainId={testnet}
                tick="GATE"
                issuerAddress={SOURCE.address}
                onBack={() => {}}
            />,
            client,
        );
        await openSection('Access');
        const threshold = await screen.findByRole('textbox', { name: 'Unlock threshold' });
        const input = screen.getByLabelText('File to publish');
        fireEvent.change(input, {
            target: { files: [new File(['abc'], 'gated.txt', { type: 'text/plain' })] },
        });
        await act(async () => readers[0].succeed(3));
        fireEvent.change(threshold, { target: { value: '1.234' } });
        fireEvent.click(screen.getByRole('button', { name: 'Publish File' }));

        expect(await screen.findByRole('alert')).toHaveTextContent('at most 2 decimal places');
    });

    it('refuses a threshold when the refreshed activation height is stale', async () => {
        const testnet = 'bitcoin-testnet';
        const client = messaging();
        client.getAddressesByChain.mockResolvedValue({ [testnet]: [SOURCE] });
        client.getTokenInfo.mockResolvedValue({ creator: SOURCE.address, divisibility: 8 });
        client.getIndexerWatermark = vi.fn()
            .mockResolvedValueOnce({ watermark: 5 })
            .mockResolvedValueOnce({ watermark: -1 });
        mount(
            <GatedPublishForm
                walletId="w"
                chainId={testnet}
                tick="GATE"
                issuerAddress={SOURCE.address}
                onBack={() => {}}
            />,
            client,
        );
        await openSection('Access');
        const threshold = await screen.findByRole('textbox', { name: 'Unlock threshold' });
        const input = screen.getByLabelText('File to publish');
        fireEvent.change(input, {
            target: { files: [new File(['abc'], 'gated.txt', { type: 'text/plain' })] },
        });
        await act(async () => readers[0].succeed(3));
        fireEvent.change(threshold, { target: { value: '1.25' } });
        fireEvent.click(screen.getByRole('button', { name: 'Publish File' }));

        expect(await screen.findByRole('alert')).toHaveTextContent('not active on this network right now');
        expect(client.getIndexerWatermark).toHaveBeenCalledTimes(2);
    });
});
