// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// GH #36 second sweep. `f57f4c6d` fixed six Token Actions forms that opened
// on `Object.keys(byChain)[0]` - the wallet's OLDEST chain, since
// `addresses.byChain` is built in address-creation order - instead of the
// last-used chain `pickDefaultChainId` already reads out of Settings. This
// file covers the same defect found in six more forms during the sweep for
// more callers of the same hand-rolled `Object.keys(byChain)[0]` / first-key
// pattern: AdvancedActionsForm, ControllerBindForm, SignMessageForm,
// TokenWizard, LinkForm and PsbtSignForm, plus Receive falling back to the
// oldest chain when ReceivePicker sends no prefill.
//
// AttachContentForm is deliberately NOT covered here: its chain is a
// required prop resolved by the caller from the token's own genesis chain,
// with no chain selector and no first-key fallback to regress.
//
// SignMessageForm and PsbtSignForm each render `ChainPicker` with props
// (`chains` / `selectedChainId`) that do not match the component's actual
// API (`chainIds` / `value`), a pre-existing defect unrelated to this issue -
// the picker always shows its placeholder. Those two forms are pinned
// through the chain-scoped "Signing address" / "Address" select instead,
// which does react correctly to the internal `chainId` default.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { AdvancedActionsForm } from '../../../packages/core/src/shared/routes/AdvancedActionsForm.jsx';
import { ControllerBindForm } from '../../../packages/core/src/shared/routes/ControllerBindForm.jsx';
import { SignMessageForm } from '../../../packages/core/src/shared/routes/SignMessageForm.jsx';
import { TokenWizard } from '../../../packages/core/src/shared/routes/TokenWizard.jsx';
import { LinkForm } from '../../../packages/core/src/shared/routes/LinkForm.jsx';
import { PsbtSignForm } from '../../../packages/core/src/shared/routes/PsbtSignForm.jsx';
import { Receive } from '../../../packages/core/src/shared/routes/Receive.jsx';

const BTC = 'bitcoin-mainnet';
const DOGE = 'dogecoin-mainnet';
const LTC = 'litecoin-mainnet';

const addr = (chainPrefix, coinType, id) => ({
    id,
    address: `${chainPrefix}1q${id}${id}${id}${id}${id}${id}${id}${id}`,
    publicKey: `02${id}`,
    derivationPath: `m/84'/${coinType}'/0'/0/0`,
    source: 'hd',
    signerId: 'signer-1',
});

const ADDR_BTC = Object.freeze(addr('bc', 0, 'bc-0'));
const ADDR_DOGE = Object.freeze(addr('doge', 3, 'doge-0'));
const ADDR_LTC = Object.freeze(addr('ltc', 2, 'ltc-0'));

// Key order is creation order: Bitcoin first, then Dogecoin, then Litecoin.
// The old default read exactly this order.
const CHAIN_ADDRESSES = Object.freeze({
    [BTC]: [ADDR_BTC],
    [DOGE]: [ADDR_DOGE],
    [LTC]: [ADDR_LTC],
});
const CHAIN_ACTIVE = Object.freeze({
    [BTC]: { id: ADDR_BTC.id }, [DOGE]: { id: ADDR_DOGE.id }, [LTC]: { id: ADDR_LTC.id },
});

const settingsWith = (lastUsedChain) => ({
    walletMode: 'full', activeNetwork: 'mainnet', lastUsedChain,
});

/**
 * A messaging stub whose unknown methods resolve to an empty rows payload,
 * so a form's incidental lookups neither throw nor have to be enumerated.
 */
function messagingWith(overrides = {}) {
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ ...CHAIN_ADDRESSES }),
        getActiveAddresses: vi.fn().mockResolvedValue({ ...CHAIN_ACTIVE }),
        getSettings: vi.fn().mockResolvedValue(settingsWith({ mainnet: DOGE })),
        updateSettings: vi.fn().mockResolvedValue({}),
        signerReady: vi.fn().mockResolvedValue({ ready: false }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        getWalletBalances: vi.fn().mockResolvedValue({}),
        listActions: vi.fn().mockResolvedValue(['SEND', 'ISSUE']),
        getNewestAddress: vi.fn().mockImplementation((_w, chainId) => Promise.resolve(
            ({ [BTC]: ADDR_BTC, [DOGE]: ADDR_DOGE, [LTC]: ADDR_LTC })[chainId] || null,
        )),
    };
    Object.assign(target, overrides);
    return new Proxy(target, {
        get(t, prop) {
            if (prop in t) return t[prop];
            return () => Promise.resolve({ rows: [] });
        },
        has: (t, prop) => prop in t,
    });
}

function mount(Form, props, messaging) {
    render(
        React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(Form, { walletId: 'w', onBack() {}, ...props }),
        ),
    );
    return messaging;
}

afterEach(() => cleanup());

// Every NetworkField-based form renders the chain through a button whose
// accessible name is "Network: <display name>".
const expectNetworkButton = async (displayName) => {
    await waitFor(async () => {
        const button = await screen.findByRole('button', { name: /^Network: / });
        expect(button.getAttribute('aria-label') || button.textContent)
            .toMatch(new RegExp(`^Network: ${displayName}`));
    });
};

describe('AdvancedActionsForm chain default', () => {
    it('opens on the last-used chain, not the first-created one', async () => {
        const messaging = mount(AdvancedActionsForm, {}, messagingWith());
        await expectNetworkButton('Dogecoin');
        expect(messaging.getSettings).toHaveBeenCalled();
    });

    it('falls back to the first chain when the last-used chain has no addresses any more', async () => {
        mount(AdvancedActionsForm, {}, messagingWith({
            getSettings: vi.fn().mockResolvedValue(settingsWith({ mainnet: 'dogecoin-testnet' })),
        }));
        await expectNetworkButton('Bitcoin');
    });

    it('still opens, on the first chain, when the settings read fails', async () => {
        mount(AdvancedActionsForm, {}, messagingWith({
            getSettings: vi.fn().mockRejectedValue(new Error('vault locked')),
        }));
        await expectNetworkButton('Bitcoin');
    });
});

describe('TokenWizard chain default', () => {
    async function mountOnChainStage(messaging) {
        mount(TokenWizard, {}, messaging);
        const memeCard = await screen.findByRole('button', { name: /Meme token/ });
        fireEvent.click(memeCard);
    }

    it('opens the chain stage on the last-used chain, not the first-created one', async () => {
        const messaging = messagingWith();
        await mountOnChainStage(messaging);
        await expectNetworkButton('Dogecoin');
    });

    it('falls back to the first chain when the last-used chain has no addresses any more', async () => {
        await mountOnChainStage(messagingWith({
            getSettings: vi.fn().mockResolvedValue(settingsWith({ mainnet: 'dogecoin-testnet' })),
        }));
        await expectNetworkButton('Bitcoin');
    });
});

describe('ControllerBindForm chain default', () => {
    it('opens on the last-used chain when the route seeds no chain', async () => {
        mount(ControllerBindForm, {}, messagingWith());
        await expectNetworkButton('Dogecoin');
    });

    it('a chain seeded by the route still wins over the last-used chain', async () => {
        mount(ControllerBindForm, { chainId: LTC }, messagingWith());
        await expectNetworkButton('Litecoin');
    });

    it('falls back to the first chain when the last-used chain has no addresses any more', async () => {
        mount(ControllerBindForm, {}, messagingWith({
            getSettings: vi.fn().mockResolvedValue(settingsWith({ mainnet: 'dogecoin-testnet' })),
        }));
        await expectNetworkButton('Bitcoin');
    });
});

describe('LinkForm chain default', () => {
    const chainButtons = async () => screen.findAllByRole('button', { name: /^Chain: / });

    it('COIN1 opens on the last-used chain, not the first-created one', async () => {
        mount(LinkForm, {}, messagingWith());
        await waitFor(async () => {
            const [first] = await chainButtons();
            expect(first.getAttribute('aria-label')).toMatch(/^Chain: Dogecoin/);
        });
    });

    it('COIN2 still lands on a distinct chain from COIN1', async () => {
        mount(LinkForm, {}, messagingWith());
        await waitFor(async () => {
            const [first, second] = await chainButtons();
            const firstName = first.getAttribute('aria-label');
            const secondName = second.getAttribute('aria-label');
            expect(firstName).not.toEqual(secondName);
            expect(secondName).toMatch(/^Chain: Bitcoin/);
        });
    });

    it('falls back to the first chain when the last-used chain has no addresses any more', async () => {
        mount(LinkForm, {}, messagingWith({
            getSettings: vi.fn().mockResolvedValue(settingsWith({ mainnet: 'dogecoin-testnet' })),
        }));
        await waitFor(async () => {
            const [first] = await chainButtons();
            expect(first.getAttribute('aria-label')).toMatch(/^Chain: Bitcoin/);
        });
    });
});

// SignMessageForm and PsbtSignForm both render a Chain picker whose props
// (`chains` / `selectedChainId`) do not match ChainPicker's real API
// (`chainIds` / `value`), so the picker never shows a selection - a
// pre-existing, separate defect out of scope for this issue. The internal
// `chainId` default is still verified through the chain-scoped address
// select, which correctly reacts to it.
describe('SignMessageForm chain default', () => {
    const addressSelect = async () => screen.findByRole('combobox', { name: 'Address' });

    it('defaults the signing chain to the last-used chain, not the first-created one', async () => {
        mount(SignMessageForm, {}, messagingWith());
        await waitFor(async () => expect((await addressSelect()).value).toBe(ADDR_DOGE.id));
    });

    it('falls back to the first chain when the last-used chain has no addresses any more', async () => {
        mount(SignMessageForm, {}, messagingWith({
            getSettings: vi.fn().mockResolvedValue(settingsWith({ mainnet: 'dogecoin-testnet' })),
        }));
        await waitFor(async () => expect((await addressSelect()).value).toBe(ADDR_BTC.id));
    });

    it('still opens, on the first chain, when the settings read fails', async () => {
        mount(SignMessageForm, {}, messagingWith({
            getSettings: vi.fn().mockRejectedValue(new Error('vault locked')),
        }));
        await waitFor(async () => expect((await addressSelect()).value).toBe(ADDR_BTC.id));
    });
});

describe('PsbtSignForm chain default', () => {
    const addressSelect = async () => screen.findByRole('combobox', { name: 'Signing address' });

    it('defaults the signing chain to the last-used chain, not the first-created one', async () => {
        mount(PsbtSignForm, {}, messagingWith());
        await waitFor(async () => expect((await addressSelect()).value).toBe(ADDR_DOGE.id));
    });

    it('falls back to the first chain when the last-used chain has no addresses any more', async () => {
        mount(PsbtSignForm, {}, messagingWith({
            getSettings: vi.fn().mockResolvedValue(settingsWith({ mainnet: 'dogecoin-testnet' })),
        }));
        await waitFor(async () => expect((await addressSelect()).value).toBe(ADDR_BTC.id));
    });
});

describe('Receive chain default', () => {
    const tokenButton = async () => screen.findByRole('button', { name: /^Token: / });

    it('opens on the last-used chain, not the first-created one', async () => {
        mount(Receive, {}, messagingWith());
        await waitFor(async () => {
            expect((await tokenButton()).getAttribute('aria-label')).toMatch(/on Dogecoin/);
        });
    });

    it('a chain sent by ReceivePicker prefill still wins over the last-used chain', async () => {
        mount(Receive, { prefill: { chainId: LTC } }, messagingWith());
        await waitFor(async () => {
            expect((await tokenButton()).getAttribute('aria-label')).toMatch(/on Litecoin/);
        });
    });

    it('falls back to the first chain when the last-used chain has no addresses any more', async () => {
        mount(Receive, {}, messagingWith({
            getSettings: vi.fn().mockResolvedValue(settingsWith({ mainnet: 'dogecoin-testnet' })),
        }));
        await waitFor(async () => {
            expect((await tokenButton()).getAttribute('aria-label')).toMatch(/on Bitcoin/);
        });
    });

    it('still opens, on the first chain, when the settings read fails', async () => {
        mount(Receive, {}, messagingWith({
            getSettings: vi.fn().mockRejectedValue(new Error('vault locked')),
        }));
        await waitFor(async () => {
            expect((await tokenButton()).getAttribute('aria-label')).toMatch(/on Bitcoin/);
        });
    });
});
