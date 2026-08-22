// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Mock XChainProvider for exercising @xchain-wallet/bridge-spec without a
// real wallet. Useful for:
//
//   - dApp integration tests that don't want to spin up the extension
//   - Worked examples for third-party integrators
//   - Type conformance check: if the mock compiles against XChainProvider,
//     the interface is coherent
//
// This is NOT the wallet's production inject script - that lives in
// @xchain-wallet/extension once implemented. The shapes here are what a
// well-behaved provider should return; they are not authoritative responses
// for any real chain state.

import {
    formatSignInChallenge,
    SIGN_IN_CHALLENGE_VERSION,
    SIGN_IN_DEFAULT_EXPIRY_MS,
    BRIDGE_SPEC_VERSION,
    PROVIDER_READY_EVENT,
    type XChainProvider,
    type ConnectOpts,
    type ConnectResult,
    type Account,
    type Address,
    type Balance,
    type ChainDescriptor,
    type ChainId,
    type SignMessageParams,
    type SignMessageResult,
    type SignActionParams,
    type SignActionResult,
    type SignPsbtParams,
    type SignPsbtResult,
    type SignInParams,
    type SignInResult,
    type BridgeEventMap,
    type BridgeEvent,
    type SitePermissions,
} from '@xchain-wallet/bridge-spec';

export interface MockProviderOptions {
    accounts?: Account[];
    addresses?: Record<ChainId, Address[]>;
    balances?: Record<string, Balance[]>; // key: `${chainId}|${address}`
    supportedChains?: ChainDescriptor[];
    activeChains?: ChainId[];
    // If true, connect() resolves without prompting (auto-approve). Matches
    // the "already-permissioned origin" case. Default true.
    autoApprove?: boolean;
    // If true, any sign* method returns USER_REJECTED. Lets tests exercise
    // the error path.
    rejectAll?: boolean;
    // If true, every connect / sign* call returns BLOCKED_BY_USER -
    // models the "user un-blocks in wallet Settings" flow (§12 / Cluster S
    // FOLLOWUP 5). Higher priority than `rejectAll` so the dApp branch
    // for "blocked, no retry" is reachable.
    blockedSite?: boolean;
    // If set, every sign* call returns THROTTLED with the supplied
    // `retryAfterMs` (and optional `burst` / `windowMs`). Higher priority
    // than `rejectAll`. Used to exercise the dApp's retry-after path.
    throttle?: { retryAfterMs: number; burst?: number; windowMs?: number };
    // Only these ACTION types are claimed as supported by signAction;
    // anything else returns UNSUPPORTED_ACTION. Default Phase 1 set. This
    // is the wallet's SIGNABLE set and is deliberately a SUBSET of the
    // descriptor's protocol set (DEFAULT_PROTOCOL_ACTIONS below): a chain
    // advertising ISSUE does not mean this wallet will sign ISSUE.
    supportedActions?: string[];
}

// Two distinct action contracts, kept apart exactly as the real extension
// bridge keeps them (extension/src/bridge/handlers.js):
//
//   - ChainDescriptor.supportedActions advertises what the CHAIN'S PROTOCOL
//     accepts. The live bridge returns the registry's full set verbatim from
//     getSupportedChains (30+ actions on a bitcoin chain).
//   - The wallet's SIGNABLE set is much smaller (SUPPORTED_BRIDGE_ACTIONS =
//     ['SEND', 'SWEEP']) and is only reported on an UNSUPPORTED_ACTION refusal
//     from signAction.
//
// A dApp that reads the descriptor as "actions this wallet will sign" is wrong
// against the live extension, so the mock advertises the registry-shaped set
// here and refuses everything outside the signable set in signAction. Source
// of truth for the protocol list: packages/core/src/registry/actions.js
// (BITCOIN_ACTIONS); this package depends only on @xchain-wallet/bridge-spec,
// so the list is a literal here rather than an import of wallet internals.
export const DEFAULT_PROTOCOL_ACTIONS: readonly string[] = [
    'ADDRESS', 'AIRDROP', 'BATCH', 'BET', 'BROADCAST', 'CALLBACK', 'COINPAY',
    'COLLECT', 'DELEGATE', 'DEPLOY', 'DEPOSIT', 'DESTROY', 'DISPENSER',
    'DIVIDEND', 'EXECUTE', 'FILE', 'ISSUE', 'LINK', 'LIST', 'MESSAGE', 'MINT',
    'ORDER', 'PRICE', 'SEND', 'SLEEP', 'STAKE', 'SWAP', 'SWEEP', 'UNSTAKE',
    'VOTE', 'WITHDRAW',
];
export const DEFAULT_SIGNABLE_ACTIONS: readonly string[] = ['SEND', 'SWEEP'];

const hexEncode = (s: string): string =>
    Array.from(s, (c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join(
        '',
    );

const DEFAULT_ACCOUNT: Account = { id: 'acct-0', name: 'Main' };

const DEFAULT_CHAIN: ChainDescriptor = {
    id: 'bitcoin-regtest',
    coin: 'bitcoin',
    displayName: 'Bitcoin',
    networkKind: 'regtest',
    color: '#F7931A',
    icon: '',
    addressTypes: ['p2wpkh'],
    defaultAddressType: 'p2wpkh',
    // Protocol set, NOT the signable set: see DEFAULT_PROTOCOL_ACTIONS.
    supportedActions: [...DEFAULT_PROTOCOL_ACTIONS],
    uriScheme: 'bitcoin',
};

const DEFAULT_ADDRESS: Address = {
    id: 'addr-0',
    accountId: DEFAULT_ACCOUNT.id,
    chain: 'bitcoin',
    network: 'regtest',
    addressType: 'p2wpkh',
    address: 'bcrt1qexampleaddressforsmoketesting0000000000',
    label: 'Address #0',
};

export class MockXChainProvider implements XChainProvider {
    readonly version: string = BRIDGE_SPEC_VERSION;
    readonly isXChainWallet = true as const;

    private readonly opts: Required<Omit<MockProviderOptions, 'throttle'>> & {
        throttle: { retryAfterMs: number; burst?: number; windowMs?: number } | null;
    };
    private connected = false;
    private grantedPermissions: SitePermissions | null = null;
    private readonly listeners = new Map<
        BridgeEvent,
        Set<BridgeEventMap[BridgeEvent]>
    >();

    constructor(opts: MockProviderOptions = {}) {
        this.opts = {
            accounts: opts.accounts ?? [DEFAULT_ACCOUNT],
            addresses: opts.addresses ?? {
                'bitcoin-regtest': [DEFAULT_ADDRESS],
            },
            balances: opts.balances ?? {
                [`bitcoin-regtest|${DEFAULT_ADDRESS.address}`]: [
                    {
                        asset: 'BTC',
                        assetType: 'native',
                        divisibility: 8,
                        confirmedRaw: '100000000',
                        unconfirmedRaw: '0',
                        confirmed: '1.00000000',
                        unconfirmed: '0.00000000',
                    },
                ],
            },
            supportedChains: opts.supportedChains ?? [DEFAULT_CHAIN],
            activeChains: opts.activeChains ?? [DEFAULT_CHAIN.id],
            autoApprove: opts.autoApprove ?? true,
            rejectAll: opts.rejectAll ?? false,
            blockedSite: opts.blockedSite ?? false,
            throttle: opts.throttle ?? null,
            supportedActions: opts.supportedActions ?? [...DEFAULT_SIGNABLE_ACTIONS],
        };
    }

    // Priority: blockedSite > throttle > rejectAll. Returning the
    // matching error result lets sign* methods short-circuit before
    // doing any work - mirrors how the production wallet checks site
    // status before opening an approval window.
    private maybeBlockedOrThrottled(): { ok: false; error: 'BLOCKED_BY_USER' } | { ok: false; error: 'THROTTLED'; retryAfterMs: number; burst?: number; windowMs?: number } | null {
        if (this.opts.blockedSite) {
            return { ok: false, error: 'BLOCKED_BY_USER' };
        }
        if (this.opts.throttle) {
            const t = this.opts.throttle;
            const out: { ok: false; error: 'THROTTLED'; retryAfterMs: number; burst?: number; windowMs?: number } = {
                ok: false,
                error: 'THROTTLED',
                retryAfterMs: t.retryAfterMs,
            };
            if (typeof t.burst === 'number') out.burst = t.burst;
            if (typeof t.windowMs === 'number') out.windowMs = t.windowMs;
            return out;
        }
        return null;
    }

    // Install as window.xchain and fire the ready event. Returns an
    // uninstall function. Target defaults to globalThis; pass a plain
    // object in non-browser environments to avoid polluting globals.
    install(target?: Record<string, unknown>): () => void {
        const host = (target ?? globalThis) as Record<string, unknown>;
        host.xchain = this;
        if (typeof globalThis.dispatchEvent === 'function') {
            globalThis.dispatchEvent(new Event(PROVIDER_READY_EVENT));
        }
        return () => {
            if (host.xchain === this) delete host.xchain;
        };
    }

    async connect(_opts?: ConnectOpts): Promise<ConnectResult> {
        const blockedOrThrottled = this.maybeBlockedOrThrottled();
        if (blockedOrThrottled) return blockedOrThrottled;
        if (!this.opts.autoApprove) {
            return { ok: false, error: 'USER_REJECTED' };
        }
        this.connected = true;
        this.grantedPermissions = {
            chains: this.opts.supportedChains.map((c) => c.coin),
            accounts: this.opts.accounts.map((a) => a.id),
            canSignMessage: true,
            canSignAction: { SEND: 'ask', SWEEP: 'ask' },
        };
        this.emit('accountsChanged', this.opts.accounts);
        return {
            ok: true,
            version: this.version,
            accounts: this.opts.accounts,
            chains: this.opts.supportedChains.map((c) => c.coin),
            permissions: this.grantedPermissions,
        };
    }

    async disconnect(): Promise<void> {
        this.connected = false;
        this.grantedPermissions = null;
        this.emit('disconnect', 'user-requested');
    }

    async getAccounts(): Promise<Account[]> {
        this.assertConnected();
        return this.opts.accounts;
    }

    async getAddresses(chainId: ChainId): Promise<Address[]> {
        this.assertConnected();
        return this.opts.addresses[chainId] ?? [];
    }

    async getBalances(chainId: ChainId, address: string): Promise<Balance[]> {
        this.assertConnected();
        return this.opts.balances[`${chainId}|${address}`] ?? [];
    }

    async getSupportedChains(): Promise<ChainDescriptor[]> {
        return this.opts.supportedChains;
    }

    async getActiveChains(): Promise<ChainId[]> {
        return this.opts.activeChains;
    }

    async signMessage(params: SignMessageParams): Promise<SignMessageResult> {
        const blockedOrThrottled = this.maybeBlockedOrThrottled();
        if (blockedOrThrottled) return blockedOrThrottled;
        if (this.opts.rejectAll) return { ok: false, error: 'USER_REJECTED' };
        this.assertConnected();
        return {
            ok: true,
            address: params.address,
            signedMessage: params.message,
            signature: `mock-sig:${hexEncode(params.message).slice(0, 32)}`,
        };
    }

    async signAction<TParams = Record<string, unknown>>(
        params: SignActionParams<TParams>,
    ): Promise<SignActionResult> {
        const blockedOrThrottled = this.maybeBlockedOrThrottled();
        if (blockedOrThrottled) return blockedOrThrottled;
        if (this.opts.rejectAll) return { ok: false, error: 'USER_REJECTED' };
        this.assertConnected();
        if (!this.opts.supportedActions.includes(params.action)) {
            return {
                ok: false,
                error: 'UNSUPPORTED_ACTION',
                supportedActions: this.opts.supportedActions,
                message: `Action ${params.action} not yet surfaced`,
            };
        }
        // No actionIndex: a real wallet resolves signAction at BROADCAST and
        // the index is assigned later by the indexer, so the field is optional
        // and a mock that always sends one teaches dApp authors to depend on
        // something the production bridge cannot give them.
        return {
            ok: true,
            chainId: params.chainId,
            txid: `mock-txid-${Date.now().toString(16)}`,
        };
    }

    async signPsbt(params: SignPsbtParams): Promise<SignPsbtResult> {
        const blockedOrThrottled = this.maybeBlockedOrThrottled();
        if (blockedOrThrottled) return blockedOrThrottled;
        if (this.opts.rejectAll) return { ok: false, error: 'USER_REJECTED' };
        this.assertConnected();
        const signed = params.psbtHex + 'deadbeef';
        if (params.broadcast === false) {
            return { ok: true, signedPsbtHex: signed };
        }
        return {
            ok: true,
            signedPsbtHex: signed,
            txHex: 'mock-txhex',
            txid: `mock-txid-${Date.now().toString(16)}`,
        };
    }

    async signIn(params: SignInParams): Promise<SignInResult> {
        const blockedOrThrottled = this.maybeBlockedOrThrottled();
        if (blockedOrThrottled) return blockedOrThrottled;
        if (this.opts.rejectAll) return { ok: false, error: 'USER_REJECTED' };
        this.assertConnected();
        const firstAddress = this.opts.addresses[this.opts.activeChains[0]!]?.[0];
        if (!firstAddress) {
            return { ok: false, error: 'ADDRESS_NOT_AUTHORIZED' };
        }
        const now = Date.now();
        const expiresAt = now + (params.expiresInMs ?? SIGN_IN_DEFAULT_EXPIRY_MS);
        const parts = {
            version: SIGN_IN_CHALLENGE_VERSION as 2,
            appId: params.appId,
            // A real wallet stamps the requesting page's origin at the
            // content-script boundary; the mock uses the page it runs in.
            origin: globalThis.location?.origin ?? 'https://mock-dapp.example',
            address: firstAddress.address,
            nonce: params.nonce ?? `mock-nonce-${now.toString(16)}`,
            timestamp: now,
            expiresAt,
        };
        const challenge = formatSignInChallenge(parts);
        return {
            ok: true,
            address: firstAddress.address,
            chainId: this.opts.activeChains[0]!,
            challenge,
            challengeParts: parts,
            signature: `mock-sig:${challenge.length.toString(16)}`,
        };
    }

    async parallel(
        actions: SignActionParams[],
    ): Promise<SignActionResult[]> {
        const results: SignActionResult[] = [];
        for (const a of actions) results.push(await this.signAction(a));
        return results;
    }

    on<E extends BridgeEvent>(event: E, handler: BridgeEventMap[E]): void {
        let set = this.listeners.get(event);
        if (!set) {
            set = new Set();
            this.listeners.set(event, set);
        }
        set.add(handler as BridgeEventMap[BridgeEvent]);
    }

    off<E extends BridgeEvent>(event: E, handler: BridgeEventMap[E]): void {
        this.listeners
            .get(event)
            ?.delete(handler as BridgeEventMap[BridgeEvent]);
    }

    private emit<E extends BridgeEvent>(
        event: E,
        ...args: Parameters<BridgeEventMap[E]>
    ): void {
        const set = this.listeners.get(event);
        if (!set) return;
        for (const fn of set) {
            (fn as (...a: unknown[]) => void)(...args);
        }
    }

    private assertConnected(): void {
        if (!this.connected) {
            throw new Error('MockXChainProvider: not connected');
        }
    }
}
