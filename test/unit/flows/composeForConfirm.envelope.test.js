// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A public file above the legacy 8 KB ceiling, published through the confirm
// lane on BTC. PublishFileForm asks for AUTO, composeForConfirm returns the
// Taproot commit, its reveal and the recovery record, and Approve signs both
// composed PSBTs byte-identically before either is broadcast.
//
// The form is rendered for real and the host side is the real composeForConfirm
// and submitWithSigner behind a stub encoder, so what is pinned is the carry
// from the encoder's answer to the signer, not any one layer's shape.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act as domAct, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { PublishFileForm } from '../../../packages/core/src/shared/routes/PublishFileForm.jsx';
import { composeForConfirm } from '../../../packages/core/src/flows/composeForConfirm.js';
import { submitWithSigner } from '../../../packages/core/src/sdk/submitWithSigner.js';
import { defaultRegistry } from '../../../packages/core/src/registry/index.js';
import { listPendingCommits } from '../../../packages/core/src/shared/utils/envelopeRecoveryMemory.js';
import { MAX_COMPILED_ACTION_BYTES } from '../../../packages/core/src/flows/fileSizeLimits.js';

const CHAIN = 'bitcoin-regtest';
const FILE_BYTES = 20000;

const ENVELOPE = Object.freeze({
    commitTxid: 'aa'.repeat(32),
    commitVout: 0,
    commitValue: 15000,
    commitAddress: 'bcrt1pcommitcommitcommitcommitcommitcommitcommitcommitcommit',
    internalPubkey: 'bb'.repeat(32),
    tapleafHash: 'cc'.repeat(32),
});
const COMMIT_PSBT = '70736274ff01c0';
const REVEAL_PSBT = '70736274ff02e0';

const SOFTWARE = Object.freeze({
    id: 'addr-0',
    address: 'bcrt1qspenderspenderspenderspenderspender',
    publicKey: '02' + 'dd'.repeat(32),
    derivationPath: "m/84'/1'/0'/0/0",
    source: 'hd',
});
const TREZOR = Object.freeze({ ...SOFTWARE, id: 'addr-hw', source: 'trezor', signerId: 'signer-hw' });

async function drain(rounds = 20) {
    for (let i = 0; i < rounds; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await Promise.resolve();
    }
}

/**
 * The host behind `messaging`: the real compose and the real submit, over a stub
 * encoder that answers AUTO the way xchain-encoder does (TAPROOT for a
 * tapscript-capable signer) and a signer that records what it signed.
 *
 * @param {{ byChain?: object, dropReveal?: boolean }} [opts]
 *   dropReveal: stand in for a host envelope that lost the reveal on the way.
 */
function harness({ byChain = { [CHAIN]: [SOFTWARE] }, dropReveal = false } = {}) {
    const trace = [];
    const chainRegistry = defaultRegistry();
    const createTx = vi.fn(async (opts) => {
        // As xchain-encoder decides: AUTO reaches the envelope only with the signer's
        // capability asserted AND a compressed internal key, else it falls to P2WSH.
        const envelope = opts.encoding === 'AUTO' && opts.options?.signerSupportsTapscript === true
            && /^(02|03)[0-9a-f]{64}$/.test(opts.compressedPubKey ?? '');
        return envelope
            ? { psbt: COMMIT_PSBT, encoding: 'TAPROOT', revealPsbt: REVEAL_PSBT, carrierScripts: ['00'], envelope: { ...ENVELOPE } }
            : { psbt: '70736274ff03', encoding: 'P2WSH', carrierScripts: [] };
    });
    const broadcastTx = vi.fn(async (hex) => {
        trace.push({ step: 'broadcast', hex, pending: listPendingCommits().map((r) => r.commitTxid) });
        return {};
    });
    const sdk = {
        encoder: { createTx, broadcastTx, spendP2sh: vi.fn() },
        actions: {
            createAction: ({ action }) => ({ actionString: `${action}|0|big.bin|application/octet-stream`, action, version: 0 }),
        },
        wallet: { decomposePsbt: () => ({ inputs: [{}], outputs: [] }) },
    };
    const sdkRegistry = { get: () => sdk };
    const vault = { settings: { get: async () => ({ ads: { enabled: false, perChain: {} } }) } };
    const signPsbt = vi.fn(async ({ psbtHex, envelopeReveal }) => {
        trace.push({ step: envelopeReveal ? 'signReveal' : 'signCommit', psbtHex });
        return envelopeReveal
            ? { txHex: `REVEALHEX(${psbtHex})`, txid: 'REVEALTXID' }
            : { txHex: `COMMITHEX(${psbtHex})`, txid: ENVELOPE.commitTxid };
    });
    // Everything crossing the host boundary is serialized, as it is in every shell.
    const wire = (v) => JSON.parse(JSON.stringify(v));
    const calls = [];

    const target = {
        getAddressesByChain: () => Promise.resolve(byChain),
        getActiveAddresses: () => Promise.resolve({}),
        signerReady: () => Promise.resolve({ ready: true }),
        getSettings: () => Promise.resolve({ walletMode: 'full' }),
        getSignerStatus: () => Promise.resolve({ status: 'unlocked' }),
        preflight: () => Promise.resolve({ verdict: 'pass', findings: [] }),
        composeForConfirm: async (req) => {
            calls.push({ method: 'composeForConfirm', req: wire(req) });
            const composed = await composeForConfirm({
                sdkRegistry, chainRegistry, vault,
                chainId: req.chainId,
                actionData: req.actionData,
                encoderOpts: { pubkey: req.from.publicKey, ...(req.encoderOpts || {}) },
                source: req.from.address,
                // The host hands over the spending record the same way.
                signer: req.from,
            });
            const envelope = wire(composed);
            if (dropReveal) { envelope.revealPsbt = null; envelope.envelope = null; }
            return envelope;
        },
        fileAction: async (req) => {
            calls.push({ method: 'fileAction', req: wire(req) });
            return submitWithSigner({
                sdkRegistry, chainRegistry,
                chainId: req.chainId,
                actionData: { action: 'FILE', params: {} },
                encoderOpts: { pubkey: req.from.publicKey, change: req.from.address },
                signer: { kind: 'software', signPsbt },
                signingPaths: [{ inputIndex: 0, path: req.from.derivationPath }],
                prebuiltPsbt: wire(req).prebuiltPsbt,
            });
        },
    };
    const messaging = new Proxy(target, {
        get(t, prop) {
            if (prop in t) return t[prop];
            return (args) => { calls.push({ method: String(prop), req: args }); return Promise.resolve({}); };
        },
    });
    return { messaging, calls, trace, createTx, signPsbt, broadcastTx };
}

async function mount(h) {
    let utils;
    await domAct(async () => {
        utils = render(React.createElement(
            MessagingProvider,
            { shell: 'web', messaging: h.messaging },
            React.createElement(PublishFileForm, { walletId: 'w', onBack() {} }),
        ));
        await drain();
    });
    return utils;
}

async function pickFile(utils, size = FILE_BYTES) {
    const bytes = new Uint8Array(size);
    for (let i = 0; i < size; i += 1) bytes[i] = (i * 31 + 7) & 0xff;
    const file = new File([bytes], 'big.bin', { type: 'application/octet-stream' });
    const input = utils.container.querySelector('input[type="file"]');
    await domAct(async () => { fireEvent.change(input, { target: { files: [file] } }); await drain(); });
    return file;
}

async function publishAndApprove(utils) {
    await waitFor(() => expect(utils.getByRole('button', { name: 'Publish file' }).disabled).toBe(false));
    const ack = utils.getByLabelText(/on-chain forever/);
    await domAct(async () => { fireEvent.click(ack); await drain(); });
    await domAct(async () => { fireEvent.click(utils.getByRole('button', { name: 'Publish file' })); await drain(); });
    const approve = await waitFor(() => {
        const el = utils.container.querySelector('[data-testid="confirm-approve"]');
        expect(el && !el.disabled).toBe(true);
        return el;
    });
    await domAct(async () => { fireEvent.click(approve); await drain(); });
}

describe('a public file above the legacy cap publishes as a Taproot envelope through the confirm lane', () => {
    beforeEach(() => { localStorage.clear(); });

    it('composes with AUTO and Approve signs the composed commit and reveal before broadcasting either', async () => {
        const h = harness();
        const utils = await mount(h);
        await pickFile(utils);
        await publishAndApprove(utils);
        await waitFor(() => expect(h.broadcastTx).toHaveBeenCalledTimes(2));

        const compose = h.calls.find((c) => c.method === 'composeForConfirm');
        expect(compose.req.encoderOpts.encoding).toBe('AUTO');
        expect(compose.req.encoderOpts.options).toEqual({ signerSupportsTapscript: true });
        expect(compose.req.encoderOpts.rawData.length).toBe(FILE_BYTES);
        expect(FILE_BYTES).toBeGreaterThan(MAX_COMPILED_ACTION_BYTES);
        // Built once, at compose; Approve rebuilds nothing.
        expect(h.createTx).toHaveBeenCalledTimes(1);
        // The encoder is handed the spender's key as the envelope internal key;
        // without it AUTO lands on P2WSH and refuses anything over 8 KB.
        expect(h.createTx.mock.calls[0][0].compressedPubKey).toBe(SOFTWARE.publicKey);

        const submitted = h.calls.find((c) => c.method === 'fileAction').req.prebuiltPsbt;
        expect(submitted).toMatchObject({
            psbtHex: COMMIT_PSBT, encoding: 'TAPROOT', revealPsbt: REVEAL_PSBT, envelope: ENVELOPE,
        });

        expect(h.trace.map((t) => t.step)).toEqual(['signCommit', 'signReveal', 'broadcast', 'broadcast']);
        expect(h.trace[0].psbtHex).toBe(COMMIT_PSBT);
        expect(h.trace[1].psbtHex).toBe(REVEAL_PSBT);
        expect(h.signPsbt.mock.calls[1][0].envelopeReveal).toBe(true);
        expect(h.trace[2].hex).toBe(`COMMITHEX(${COMMIT_PSBT})`);
        expect(h.trace[3].hex).toBe(`REVEALHEX(${REVEAL_PSBT})`);
        // The recovery record was on disk when the commit went out, and is
        // cleared once the reveal landed.
        expect(h.trace[2].pending).toEqual([ENVELOPE.commitTxid]);
        expect(listPendingCommits()).toHaveLength(0);
        // The reveal carries the action, so its txid is the one shown.
        await waitFor(() => expect(utils.getByText('REVEALTXID')).toBeTruthy());
    });

    it('holds the commit the confirm screen checks to the address and value the recovery record names', async () => {
        const h = harness();
        const utils = await mount(h);
        await pickFile(utils);
        await publishAndApprove(utils);
        await waitFor(() => expect(h.broadcastTx).toHaveBeenCalledTimes(2));
        const composed = await h.createTx.mock.results[0].value;
        expect(composed.encoding).toBe('TAPROOT');
        const direct = await composeForConfirm({
            sdkRegistry: { get: () => ({ encoder: { createTx: async () => composed }, actions: { createAction: () => ({ actionString: 'FILE|0|big.bin|application/octet-stream', action: 'FILE', version: 0 }) } }) },
            chainRegistry: defaultRegistry(),
            vault: { settings: { get: async () => ({ ads: { enabled: false, perChain: {} } }) } },
            chainId: CHAIN,
            actionData: { action: 'FILE', params: {} },
            encoderOpts: { pubkey: SOFTWARE.publicKey, rawData: 'x', encoding: 'AUTO' },
            source: SOFTWARE.address,
        });
        expect(direct.expectedOutputs.addressed).toContainEqual(
            expect.objectContaining({ address: ENVELOPE.commitAddress, value: ENVELOPE.commitValue }));
        expect(direct.expectedOutputs.encoding).toBe('TAPROOT');
    });

    it('signs and broadcasts nothing when the reveal is lost between compose and Approve', async () => {
        const h = harness({ dropReveal: true });
        const utils = await mount(h);
        await pickFile(utils);
        await publishAndApprove(utils);
        await waitFor(() => expect(h.calls.some((c) => c.method === 'fileAction')).toBe(true));
        await domAct(async () => { await drain(); });

        expect(h.signPsbt).not.toHaveBeenCalled();
        expect(h.broadcastTx).not.toHaveBeenCalled();
        expect(listPendingCommits()).toHaveLength(0);
        await waitFor(() => expect(utils.container.textContent).toMatch(/did not\s+arrive with the commit/));
    });

    it('keeps a hardware source on the legacy ceiling and never asks for AUTO', async () => {
        const h = harness({ byChain: { [CHAIN]: [TREZOR] } });
        const utils = await mount(h);
        await pickFile(utils);
        await waitFor(() => expect(utils.container.textContent).toMatch(/on-chain ceiling is/));
        expect(h.calls.some((c) => c.method === 'composeForConfirm')).toBe(false);
    });
});
