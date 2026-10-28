// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// A DELEGATE to 64 hex characters that are not a signing Ed25519 key indexes
// valid (the indexer checks format only) and spends the fee on a key that can
// never sign, or on the identity point whose signatures anyone can forge. The
// form refuses both before composing, and the composer refuses them before
// signing. A revoke still accepts any recorded key.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ed25519 } from '@noble/curves/ed25519';
import { bytesToHex } from '@noble/hashes/utils';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { DelegationActionForm } from '../../../packages/core/src/shared/routes/DelegationActionForm.jsx';
import { signingKeyRefusal } from '../../../packages/core/src/flows/signingKeyCheck.js';

vi.mock('../../../packages/core/src/flows/submitAction.js', () => ({
    submitAction: vi.fn(async () => ({ txid: 'tx' })),
}));
// The indexed-state check at signing has its own tests (delegationPreSign.test.js).
vi.mock('../../../packages/core/src/flows/delegationPreSign.js', () => ({
    assertDelegationActionable: vi.fn(async () => {}),
}));
import { submitAction } from '../../../packages/core/src/flows/submitAction.js';
import { delegateAction } from '../../../packages/core/src/flows/delegateRevokeActions.js';
import { defaultRegistry } from '../../../packages/core/src/registry/index.js';

const CHAIN = 'bitcoin-mainnet';
const OFF_CURVE = '02'.repeat(32);
const IDENTITY = '01' + '00'.repeat(31);
const GOOD = bytesToHex(ed25519.getPublicKey(new Uint8Array(32).fill(3)));
const REFUSAL = 'This is not a usable Ed25519 public key. Check the key and try again.';

afterEach(cleanup);

function mount(mode) {
    const composeForConfirm = vi.fn(() => new Promise(() => {}));
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({
            [CHAIN]: [{
                id: 'addr-1', address: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq',
                publicKey: '02ab', derivationPath: "m/84'/0'/0'/0/0", source: 'hd',
            }],
        }),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: false }),
        getDelegationsForAddress: vi.fn().mockResolvedValue([]),
        composeForConfirm,
    };
    const messaging = new Proxy(target, {
        get: (object, property) => (property in object ? object[property] : () => Promise.resolve({})),
    });
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <DelegationActionForm mode={mode} walletId="wallet-1" chainId={CHAIN} onBack={() => {}} />
        </MessagingProvider>,
    );
    return { composeForConfirm };
}

async function submitKey(label, value) {
    const input = await screen.findByLabelText(label);
    fireEvent.change(input, { target: { value } });
    await act(async () => { fireEvent.submit(input.closest('form')); });
}

describe('DelegationActionForm refuses a key that cannot sign', () => {
    it.each([
        ['a value off the curve', OFF_CURVE],
        ['the identity point', IDENTITY],
        ['an off-curve value in capitals', 'D'.repeat(64)],
    ])('refuses %s with nothing composed', async (_name, value) => {
        const { composeForConfirm } = mount('delegate');
        await submitKey('New signing pubkey', value);
        expect(await screen.findByText(REFUSAL)).toBeInTheDocument();
        expect(composeForConfirm).not.toHaveBeenCalled();
    });

    it('composes a usable key', async () => {
        const { composeForConfirm } = mount('delegate');
        await submitKey('New signing pubkey', GOOD);
        await waitFor(() => expect(composeForConfirm).toHaveBeenCalledTimes(1));
        expect(composeForConfirm.mock.calls[0][0].actionData.params).toEqual({ VERSION: '0', NEW_SIGNING_PUBKEY: GOOD });
    });

    it('still composes a revoke of an off-curve key, which is how such a delegation is removed', async () => {
        const { composeForConfirm } = mount('revoke');
        await submitKey('Signing pubkey to revoke', OFF_CURVE);
        await waitFor(() => expect(composeForConfirm).toHaveBeenCalledTimes(1));
        expect(screen.queryByText(REFUSAL)).toBeNull();
    });
});

describe('delegateAction refuses a key that cannot sign', () => {
    const base = {
        chainRegistry: defaultRegistry(),
        chainId: 'bitcoin-regtest',
        walletId: 'w',
        from: { address: 'bcrt1qsource', publicKey: '02' + 'a'.repeat(64), derivationPath: "m/84'/1'/0'/0/0" },
    };

    it.each([[OFF_CURVE], [IDENTITY]])('throws for %s before anything is signed', async (key) => {
        vi.mocked(submitAction).mockClear();
        await expect(delegateAction({ ...base, params: { VERSION: '0', NEW_SIGNING_PUBKEY: key } })).rejects.toThrow(REFUSAL);
        expect(submitAction).not.toHaveBeenCalled();
    });

    it('passes a usable key through unchanged', async () => {
        vi.mocked(submitAction).mockClear();
        await delegateAction({ ...base, params: { VERSION: '0', NEW_SIGNING_PUBKEY: GOOD } });
        expect(vi.mocked(submitAction).mock.calls[0][0].actionData).toEqual({ action: 'DELEGATE', params: { VERSION: '0', NEW_SIGNING_PUBKEY: GOOD } });
    });

    it('accepts the same key in either case', () => {
        expect(signingKeyRefusal(GOOD.toUpperCase())).toBeNull();
    });
});
