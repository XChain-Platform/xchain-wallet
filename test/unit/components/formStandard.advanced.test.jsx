// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The shared Advanced section (ruling G98): wherever a form shows Speed and
// Fees, Advanced sits directly above it with no per-form markup; a form
// without Speed and Fees has none; its choices reach compose through the
// shared layer; an option the action cannot honour is hidden.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';

vi.mock('../../../packages/core/src/shared/routes/AddressList.jsx', () => ({
    AddressList: ({ onPick, networkLocked, pickerActions }) => (
        <div>
            <span data-testid="network-lock">{networkLocked ? 'locked' : 'switchable'}</span>
            <button type="button" onClick={pickerActions[0].onSelect}>{pickerActions[0].label}</button>
            <button
                type="button"
                onClick={() => onPick({ id: 'change', address: 'bc1qadvancedchange000000000000000000000' }, 'bitcoin-mainnet')}
            >
                Pick change address
            </button>
        </div>
    ),
}));

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import {
    FeeSection,
    FormAction,
    FormFrame,
    FormSection,
    FromSection,
    withAdvancedOptions,
} from '../../../packages/core/src/shared/components/formStandard/index.js';
import {
    armAdvanced,
    advancedKey,
    disarmAdvanced,
    updateAdvanced,
} from '../../../packages/core/src/shared/components/formStandard/advancedOptions.js';
import { useActionConfirmFlow } from '../../../packages/core/src/shared/hooks/useActionConfirmFlow.js';
import { defaultRegistry } from '../../../packages/core/src/registry/index.js';

const CHAIN = 'bitcoin-mainnet';
const FROM = 'bc1qadvancedfrom00000000000000000000000';
const CHANGE = 'bc1qadvancedchange000000000000000000000';
const UTXOS = [
    { txid: 'a'.repeat(64), vout: 0, value: 100000 },
    { txid: 'b'.repeat(64), vout: 1, value: 250000 },
];
const registry = defaultRegistry();

function makeMessaging(settings = {}) {
    const target = {
        getSettings: typeof settings === 'function' ? vi.fn(settings) : vi.fn().mockResolvedValue(settings),
        getAddressUtxos: vi.fn().mockResolvedValue({ utxos: UTXOS }),
        composeForConfirm: vi.fn(() => new Promise(() => {})),
    };
    const messaging = new Proxy(target, {
        get(value, key) {
            if (key in value) return value[key];
            if (key === 'then') return undefined;
            const stub = vi.fn().mockResolvedValue(null);
            value[key] = stub;
            return stub;
        },
    });
    return { target, messaging };
}

function Harness({ messaging, advanced, withFee = true, address = FROM, refuse = false, chainId = CHAIN }) {
    const flow = useActionConfirmFlow({ messaging, walletId: 'w1' });
    const from = { address: FROM, publicKey: '02aa' };
    return (
        <FormFrame
            id="harness-form"
            label="Harness"
            walletId="w1"
            onSubmit={(event) => {
                event.preventDefault();
                // A field refused the submit: nothing composes.
                if (refuse) return;
                flow.run({
                    chainId,
                    from,
                    actionData: { action: 'MINT', params: { tick: 'ABC', amount: '1' } },
                    encoderOpts: { feePerKb: 1000 },
                    onApprove: async () => ({ ok: true }),
                }).catch(() => {});
            }}
            from={<FromSection chainId={chainId} chainRegistry={registry} address={address} />}
            fee={withFee ? <FeeSection chainId={chainId} coinTicker="BTC" fixedFee="0.00001" advanced={advanced} /> : null}
            action={<FormAction>Mint Token</FormAction>}
        >
            <FormSection id="main" title="Mint" defaultOpen>
                <p>fields</p>
            </FormSection>
        </FormFrame>
    );
}

// An action outside the form (an order cancel beside the trade panel): it
// composes through the same shared layer but never armed the form's choices.
function Sibling({ messaging }) {
    const flow = useActionConfirmFlow({ messaging, walletId: 'w1' });
    return (
        <button
            type="button"
            onClick={() => flow.run({
                chainId: CHAIN,
                from: { address: FROM, publicKey: '02aa' },
                actionData: { action: 'CANCEL', params: {} },
                onApprove: async () => ({ ok: true }),
            }).catch(() => {})}
        >
            Cancel Order
        </button>
    );
}

function mount(props = {}, { sibling = false, settings = {} } = {}) {
    const { target, messaging } = makeMessaging(settings);
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <Harness messaging={messaging} {...props} />
            {sibling ? <Sibling messaging={messaging} /> : null}
        </MessagingProvider>,
    );
    return target;
}

const sectionIds = () => [...document.querySelectorAll('[data-form-section]')]
    .map((node) => node.getAttribute('data-form-section'));
const advancedHeader = () => screen.getByRole('button', { name: /^Advanced/ });

afterEach(() => {
    cleanup();
});

describe('Advanced section placement', () => {
    it('renders closed and Optional, directly above Speed and Fees, with no console warning', async () => {
        const errors = vi.spyOn(console, 'error');
        const warns = vi.spyOn(console, 'warn');
        mount();
        expect(sectionIds()).toEqual(['from', 'main', 'advanced', 'fee']);
        const header = advancedHeader();
        expect(header).toHaveAttribute('aria-expanded', 'false');
        expect(within(header).getByText('Optional')).toBeInTheDocument();
        expect(header).toHaveTextContent('Default');
        // Every option has its ? tip.
        fireEvent.click(header);
        await waitFor(() => expect(screen.getByRole('switch', { name: 'Coin control enabled' })).not.toBeDisabled());
        const section = header.closest('[data-form-section]');
        expect(within(section).getAllByRole('button', { name: /about|learn/i }).length).toBeGreaterThanOrEqual(3);
        const messages = [...errors.mock.calls, ...warns.mock.calls].map((call) => String(call[0]));
        expect(messages.filter((m) => /getSnapshot|infinite loop|Maximum update depth/.test(m))).toEqual([]);
        expect(errors).not.toHaveBeenCalled();
        errors.mockRestore();
        warns.mockRestore();
    });

    it('never renders on a form without Speed and Fees', () => {
        mount({ withFee: false });
        expect(sectionIds()).toEqual(['from', 'main']);
        expect(screen.queryByRole('button', { name: /^Advanced/ })).toBeNull();
    });

    it('never renders for a FeeSection outside a FormFrame', () => {
        const { messaging } = makeMessaging();
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <FeeSection chainId={CHAIN} coinTicker="BTC" fixedFee="0.00001" />
            </MessagingProvider>,
        );
        expect(sectionIds()).toEqual(['fee']);
    });

    it('hides the options an action cannot honour, and the whole section when it honours none', () => {
        mount({ advanced: { coins: false, change: false } });
        fireEvent.click(advancedHeader());
        expect(screen.getByRole('switch', { name: 'Allow a higher network fee later' })).toBeInTheDocument();
        expect(screen.queryByRole('switch', { name: 'Coin control enabled' })).toBeNull();
        expect(screen.queryByRole('textbox', { name: 'Change address' })).toBeNull();
        cleanup();

        mount({ advanced: false });
        expect(sectionIds()).toEqual(['from', 'main', 'fee']);
    });
});

describe('Advanced choices reach compose', () => {
    it('merges RBF, the chosen coins and the change address into the shared compose call', async () => {
        const messaging = mount();
        fireEvent.click(advancedHeader());
        fireEvent.click(screen.getByRole('switch', { name: 'Allow a higher network fee later' }));
        await waitFor(() => expect(screen.getByRole('switch', { name: 'Coin control enabled' })).not.toBeDisabled());
        fireEvent.click(screen.getByRole('switch', { name: 'Coin control enabled' }));
        fireEvent.click(screen.getByRole('checkbox', { name: /0\.001 BTC/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Change address' }));
        expect(screen.getByTestId('network-lock')).toHaveTextContent('locked');
        fireEvent.click(screen.getByRole('button', { name: 'Pick change address' }));
        expect(screen.getByRole('textbox', { name: 'Change address' })).toHaveValue(CHANGE);

        fireEvent.click(advancedHeader());
        // "Fee bumping" is the plain-language name for RBF (send.advanced.feeBumping).
        // The switch starts on (Bitcoin, no Fees setting), so the press turned it off.
        expect(advancedHeader()).toHaveTextContent('Fee bumping off · 1 coin · custom change');

        fireEvent.click(screen.getByRole('button', { name: 'Mint Token' }));
        await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalledTimes(1));
        const request = messaging.composeForConfirm.mock.calls[0][0];
        expect(request.change).toBe(CHANGE);
        expect(request.encoderOpts).toEqual({ feePerKb: 1000, rbf: false, utxos: [UTXOS[0]] });
    });

    it('composes the default while the section reads Default: fee bumping on, coins and change untouched', async () => {
        const messaging = mount();
        expect(advancedHeader()).toHaveTextContent('Default');
        fireEvent.click(screen.getByRole('button', { name: 'Mint Token' }));
        await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalledTimes(1));
        const request = messaging.composeForConfirm.mock.calls[0][0];
        expect(request).not.toHaveProperty('change');
        expect(request.encoderOpts).toEqual({ feePerKb: 1000, rbf: true });
    });

    it('never hands the form choices to an action outside the form', async () => {
        const messaging = mount({}, { sibling: true });
        fireEvent.click(advancedHeader());
        fireEvent.click(screen.getByRole('switch', { name: 'Allow a higher network fee later' }));
        fireEvent.click(screen.getByRole('button', { name: 'Cancel Order' }));
        await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalledTimes(1));
        const request = messaging.composeForConfirm.mock.calls[0][0];
        expect(request).not.toHaveProperty('encoderOpts');
        expect(request).not.toHaveProperty('change');
    });

    it('takes the choices made once the From address has loaded, not the empty first render', async () => {
        const { target, messaging } = makeMessaging();
        const view = render(
            <MessagingProvider shell="web" messaging={messaging}>
                <Harness messaging={messaging} address={null} />
            </MessagingProvider>,
        );
        // The first render knows the network but not yet the address.
        expect(advancedHeader()).toHaveTextContent('Default');
        view.rerender(
            <MessagingProvider shell="web" messaging={messaging}>
                <Harness messaging={messaging} address={FROM} />
            </MessagingProvider>,
        );
        fireEvent.click(advancedHeader());
        // The switch starts on; the press made on the loaded address turns it off.
        fireEvent.click(screen.getByRole('switch', { name: 'Allow a higher network fee later' }));
        fireEvent.click(screen.getByRole('button', { name: 'Mint Token' }));
        await waitFor(() => expect(target.composeForConfirm).toHaveBeenCalledTimes(1));
        expect(target.composeForConfirm.mock.calls[0][0].encoderOpts).toEqual({ feePerKb: 1000, rbf: false });
    });

    it('ends the arm of a refused submit when another action is pressed', async () => {
        const messaging = mount({ refuse: true }, { sibling: true });
        fireEvent.click(advancedHeader());
        fireEvent.click(screen.getByRole('switch', { name: 'Allow a higher network fee later' }));
        // The form's submit arms it, but a field refuses and nothing composes.
        fireEvent.click(screen.getByRole('button', { name: 'Mint Token' }));
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
        const cancel = screen.getByRole('button', { name: 'Cancel Order' });
        fireEvent.pointerDown(cancel);
        fireEvent.click(cancel);
        await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalledTimes(1));
        expect(messaging.composeForConfirm.mock.calls[0][0]).not.toHaveProperty('encoderOpts');
    });

    it('refuses coin control with no coin chosen before anything is composed', async () => {
        const messaging = mount();
        fireEvent.click(advancedHeader());
        await waitFor(() => expect(screen.getByRole('switch', { name: 'Coin control enabled' })).not.toBeDisabled());
        fireEvent.click(screen.getByRole('switch', { name: 'Coin control enabled' }));
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Mint Token' }));
        });
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });
});

// Operator ruling 2026-11-13: on every form the fee-bumping (RBF) switch is
// on by default wherever the network supports RBF, unless the chain's Fees
// setting turned it off; a network without RBF shows it off and locked.
describe('Fee bumping default on every form', () => {
    const DOGE = 'dogecoin-mainnet';
    const rbfSwitch = () => screen.getByRole('switch', { name: 'Allow a higher network fee later' });
    const submit = async (target) => {
        fireEvent.click(screen.getByRole('button', { name: 'Mint Token' }));
        await waitFor(() => expect(target.composeForConfirm).toHaveBeenCalledTimes(1));
        return target.composeForConfirm.mock.calls[0][0];
    };

    it('is on and composes rbf: true on Bitcoin with no Fees setting stored', async () => {
        const target = mount();
        await waitFor(() => expect(target.getSettings).toHaveBeenCalled());
        fireEvent.click(advancedHeader());
        expect(rbfSwitch()).toBeChecked();
        expect(rbfSwitch()).not.toBeDisabled();
        fireEvent.click(advancedHeader());
        expect(advancedHeader()).toHaveTextContent('Default');
        const request = await submit(target);
        expect(request.encoderOpts.rbf).toBe(true);
    });

    it('is off and composes rbf: false when the chain\'s Fees setting turned it off', async () => {
        const target = mount({}, { settings: { fees: { [CHAIN]: { rbfByDefault: false } } } });
        fireEvent.click(advancedHeader());
        await waitFor(() => expect(rbfSwitch()).not.toBeChecked());
        expect(rbfSwitch()).not.toBeDisabled();
        fireEvent.click(advancedHeader());
        expect(advancedHeader()).toHaveTextContent('Default');
        const request = await submit(target);
        expect(request.encoderOpts.rbf).toBe(false);
    });

    it('stays off and locked on Dogecoin, and composes no rbf at all', async () => {
        expect(registry.get(DOGE)?.feeStrategy?.rbfSupported).toBe(false);
        const target = mount({ chainId: DOGE });
        await waitFor(() => expect(target.getSettings).toHaveBeenCalled());
        fireEvent.click(advancedHeader());
        expect(rbfSwitch()).not.toBeChecked();
        expect(rbfSwitch()).toBeDisabled();
        fireEvent.click(advancedHeader());
        expect(advancedHeader()).toHaveTextContent('Default');
        const request = await submit(target);
        expect(request.encoderOpts).toEqual({ feePerKb: 1000 });
    });

    it('keeps a choice the user made before settings arrived', async () => {
        let resolveSettings;
        const pending = new Promise((resolve) => { resolveSettings = resolve; });
        const target = mount({}, { settings: () => pending });
        fireEvent.click(advancedHeader());
        // Off, then on again: an explicit on, made while the default is unknown.
        fireEvent.click(rbfSwitch());
        fireEvent.click(rbfSwitch());
        expect(rbfSwitch()).toBeChecked();
        await act(async () => { resolveSettings({ fees: { [CHAIN]: { rbfByDefault: false } } }); });
        expect(rbfSwitch()).toBeChecked();
        fireEvent.click(advancedHeader());
        expect(advancedHeader()).toHaveTextContent('Fee bumping on');
        const request = await submit(target);
        expect(request.encoderOpts.rbf).toBe(true);
    });

    it('does not flip the switch on while settings reload after a remount (back from a picker page)', async () => {
        let slow = false;
        const off = { fees: { [CHAIN]: { rbfByDefault: false } } };
        const { target, messaging } = makeMessaging(() => (slow ? new Promise(() => {}) : Promise.resolve(off)));
        const page = (child) => <MessagingProvider shell="web" messaging={messaging}>{child}</MessagingProvider>;
        const view = render(page(<Harness messaging={messaging} />));
        fireEvent.click(advancedHeader());
        await waitFor(() => expect(rbfSwitch()).not.toBeChecked());
        // A picker page replaces the form, then the form comes back; this
        // time the settings read has not answered yet.
        slow = true;
        view.rerender(page(null));
        view.rerender(page(<Harness messaging={messaging} />));
        expect(rbfSwitch()).not.toBeChecked();
        const request = await submit(target);
        expect(request.encoderOpts.rbf).toBe(false);
    });
});

describe('withAdvancedOptions', () => {
    const key = advancedKey({ formKey: 'f', chainId: CHAIN, address: FROM });
    const choose = () => updateAdvanced(key, {
        shown: { rbf: true, coins: true, change: true },
        rbf: false,
        coinControl: true,
        available: UTXOS,
        selectedKeys: [`${UTXOS[1].txid}:1`],
        change: CHANGE,
    });

    it('puts RBF and coins at the top of a request without actionData (vote, bet, message, SEND)', () => {
        choose();
        armAdvanced('f');
        const request = { chainId: CHAIN, from: { address: FROM }, builder: 'createPollParams', params: {} };
        expect(withAdvancedOptions(request)).toEqual({ ...request, rbf: false, utxos: [UTXOS[1]], change: CHANGE });
    });

    it('matches a message by the network that funds it', () => {
        choose();
        armAdvanced('f');
        const request = { chainId: 'litecoin-mainnet', broadcastChainId: CHAIN, from: { address: FROM } };
        expect(withAdvancedOptions(request)).toMatchObject({ change: CHANGE, rbf: false });
    });

    it('leaves the request alone when no form is armed, or for another source address', () => {
        choose();
        const request = { chainId: CHAIN, from: { address: FROM }, actionData: { action: 'X', params: {} } };
        expect(withAdvancedOptions(request)).toBe(request);
        armAdvanced('f');
        const other = { ...request, from: { address: 'bc1qsomeoneelse' } };
        expect(withAdvancedOptions(other)).toBe(other);
        disarmAdvanced();
        expect(withAdvancedOptions(request)).toBe(request);
    });

    it('drops an option the section does not show', () => {
        choose();
        updateAdvanced(key, { shown: { rbf: true, coins: false, change: false } });
        armAdvanced('f');
        const request = { chainId: CHAIN, from: { address: FROM }, actionData: { action: 'X', params: {} } };
        expect(withAdvancedOptions(request)).toEqual({ ...request, encoderOpts: { rbf: false } });
    });
});
