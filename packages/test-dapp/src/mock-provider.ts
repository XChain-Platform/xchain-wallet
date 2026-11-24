// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Mock XChainProvider for exercising @dankest-llc/xchain-connect without a
// real wallet. Useful for:
//
//   - dApp integration tests that don't want to spin up the extension
//   - Worked examples for third-party integrators
//   - Type conformance, enforced by the workspace typecheck gate
import {
    formatSignInChallenge,
    SIGN_IN_CHALLENGE_VERSION,
    SIGN_IN_DEFAULT_EXPIRY_MS,
    BRIDGE_SPEC_VERSION,
    BRIDGE_SUPPORTED_VERSIONS,
    isBridgeVersionSupported,
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
    type CoSignParams,
    type CoSignResult,
    type SignInParams,
    type SignInResult,
    type BridgeEventMap,
    type BridgeEvent,
    type SitePermissions,
} from '@dankest-llc/xchain-connect';
import { approvedCoSign, signingPathsError } from './mock-signing.js';

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
    // models the "user un-blocks in wallet Settings" flow. Higher priority
    // than `rejectAll` so the dApp branch for "blocked, no retry" is
    // reachable.
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

// Descriptor actions are the chain protocol set. The smaller signable set is
// returned only when signAction refuses an unsupported action.
export const DEFAULT_PROTOCOL_ACTIONS: readonly string[] = [
    'ADDRESS', 'AIRDROP', 'BATCH', 'BET', 'BROADCAST', 'CALLBACK', 'COINPAY',
    'COLLECT', 'DELEGATE', 'DEPLOY', 'DEPOSIT', 'DESTROY', 'DISPENSER',
    'DIVIDEND', 'EXECUTE', 'FILE', 'ISSUE', 'LINK', 'LIST', 'MESSAGE', 'MINT',
    'ORDER', 'PRICE', 'SEND', 'SLEEP', 'STAKE', 'SWAP', 'SWEEP', 'UNSTAKE',
    'VOTE', 'WITHDRAW', 'XBRIDGE',
];
export const DEFAULT_SIGNABLE_ACTIONS: readonly string[] = ['SEND', 'SWEEP'];

const hexEncode = (s: string): string =>
    Array.from(s, (c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join(
        '',
    );

// Builds the error the production bridge throws: a BridgeError whose `code`
// names the failure and whose extra hints (retryAfterMs and the like) ride along.
function codedError(code: string, message: string, hints: object = {}): Error & { code: string } {
    const error = Object.assign(new Error(message), hints, { code });
    error.name = 'BridgeError';
    return error;
}

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

    // Priority: blockedSite > not connected > chain grant > throttle > rejectAll. Returning
    // the matching error result lets sign* methods short-circuit before doing
    // any work, which mirrors how the production wallet checks site status
    // and the connection before it opens an approval window. connect() passes
    // forConnect so only the blocked-site check applies to it.
    private maybeBlockedOrThrottled(forConnect = false, chainId?: ChainId): { ok: false; error: 'BLOCKED_BY_USER' | 'NOT_CONNECTED' | 'CHAIN_NOT_SUPPORTED'; message?: string } | { ok: false; error: 'THROTTLED'; retryAfterMs: number; burst?: number; windowMs?: number } | null {
        if (this.opts.blockedSite) {
            return { ok: false, error: 'BLOCKED_BY_USER' };
        }
        if (!forConnect && !this.connected) {
            return { ok: false, error: 'NOT_CONNECTED' };
        }
        if (!forConnect && chainId && !this.isChainGranted(chainId)) {
            return {
                ok: false,
                error: 'CHAIN_NOT_SUPPORTED',
                message: `CHAIN_NOT_SUPPORTED: ${chainId} is outside the connect grant`,
            };
        }
        if (!forConnect && this.opts.throttle) {
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

    async connect(opts: ConnectOpts = {}): Promise<ConnectResult> {
        const blockedOrThrottled = this.maybeBlockedOrThrottled(true);
        if (blockedOrThrottled) return blockedOrThrottled;
        if (!isBridgeVersionSupported(opts.requiredBridgeVersion)) {
            return { ok: false, error: 'BRIDGE_VERSION_MISMATCH' };
        }
        if (!this.opts.autoApprove) {
            return { ok: false, error: 'USER_REJECTED' };
        }
        const supportedIds = this.opts.supportedChains.map((c) => c.id);
        const chains = opts.requestedChains === undefined
            ? supportedIds
            : supportedIds.filter((id) => opts.requestedChains?.includes(id));
        if (chains.length === 0) return { ok: false, error: 'USER_REJECTED' };
        this.connected = true;
        this.grantedPermissions = {
            chains,
            accounts: this.opts.accounts.map((a) => a.id),
            canSignMessage: true,
            canSignAction: { SEND: 'ask', SWEEP: 'ask' },
        };
        return {
            ok: true,
            version: this.version,
            supportedVersions: [...BRIDGE_SUPPORTED_VERSIONS],
            accounts: this.opts.accounts,
            chains,
            permissions: this.grantedPermissions,
        };
    }

    async disconnect(): Promise<void> {
        const wasConnected = this.connected;
        this.connected = false;
        this.grantedPermissions = null;
        if (wasConnected) this.emit('disconnect', 'user-requested');
    }

    async getAccounts(): Promise<Account[]> {
        this.assertConnected();
        return this.opts.accounts;
    }

    async getAddresses(chainId: ChainId): Promise<Address[]> {
        this.assertConnected();
        this.assertChainGranted(chainId);
        return this.opts.addresses[chainId] ?? [];
    }

    async getBalances(chainId: ChainId, address: string): Promise<Balance[]> {
        this.assertConnected();
        this.assertChainGranted(chainId);
        return this.opts.balances[`${chainId}|${address}`] ?? [];
    }

    async getSupportedChains(): Promise<ChainDescriptor[]> {
        return this.opts.supportedChains;
    }

    async getActiveChains(): Promise<ChainId[]> {
        this.assertConnected();
        return this.opts.activeChains.filter((id) => this.isChainGranted(id));
    }

    async signMessage(params: SignMessageParams): Promise<SignMessageResult> {
        const blockedOrThrottled = this.maybeBlockedOrThrottled(false, params.chainId);
        if (blockedOrThrottled) return blockedOrThrottled;
        if (this.opts.rejectAll) return { ok: false, error: 'USER_REJECTED' };
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
        const blockedOrThrottled = this.maybeBlockedOrThrottled(false, params.chainId);
        if (blockedOrThrottled) return blockedOrThrottled;
        if (this.opts.rejectAll) return { ok: false, error: 'USER_REJECTED' };
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
        const blockedOrThrottled = this.maybeBlockedOrThrottled(false, params.chainId);
        if (blockedOrThrottled) return blockedOrThrottled;
        const shapeError = signingPathsError(params.signingPaths);
        if (shapeError) return { ok: false, error: 'INVALID_PARAMS', message: shapeError };
        if (this.opts.rejectAll) return { ok: false, error: 'USER_REJECTED' };
        const signed = params.psbtHex + 'deadbeef';
        return { ok: true, signedPsbtHex: signed, txHex: 'mock-txhex' };
    }

    async coSign(params: CoSignParams): Promise<CoSignResult> {
        const blockedOrThrottled = this.maybeBlockedOrThrottled(false, params.chainId);
        if (blockedOrThrottled) return blockedOrThrottled;
        const { sighashType } = params;
        if (sighashType !== undefined && !Number.isInteger(sighashType)) {
            return { ok: false, error: 'INVALID_PARAMS', message: 'sighashType must be an integer' };
        }
        if (this.opts.rejectAll) return { ok: false, error: 'USER_REJECTED' };
        if (sighashType !== undefined && sighashType !== 0) {
            return {
                ok: true,
                approved: false,
                reason: 'SIGHASH_TYPE_NOT_ALLOWED',
                detail: { sighashType },
            };
        }
        return approvedCoSign(params);
    }

    async signIn(params: SignInParams): Promise<SignInResult> {
        const blockedOrThrottled = this.maybeBlockedOrThrottled();
        if (blockedOrThrottled) return blockedOrThrottled;
        if (this.opts.rejectAll) return { ok: false, error: 'USER_REJECTED' };
        if (typeof params.appId !== 'string' || params.appId.length === 0) {
            return { ok: false, error: 'INVALID_PARAMS' };
        }
        const chainId = this.opts.activeChains.find((id) => (
            this.isChainGranted(id)
            && (!params.chainId || params.chainId === id)
            && this.opts.addresses[id]?.some((a) => !params.chains?.length || params.chains.includes(a.chain))
        ));
        const firstAddress = chainId
            ? this.opts.addresses[chainId]?.find((a) => !params.chains?.length || params.chains.includes(a.chain))
            : undefined;
        if (!chainId || !firstAddress) {
            return { ok: false, error: 'ADDRESS_NOT_AUTHORIZED' };
        }
        const expiresInMs = params.expiresInMs ?? SIGN_IN_DEFAULT_EXPIRY_MS;
        if (typeof expiresInMs !== 'number' || !Number.isFinite(expiresInMs) || expiresInMs <= 0) {
            return { ok: false, error: 'INVALID_PARAMS' };
        }
        const now = Date.now();
        const expiresAt = now + expiresInMs;
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
            chainId,
            challenge,
            challengeParts: parts,
            signature: `mock-sig:${challenge.length.toString(16)}`,
        };
    }

    async parallel(
        actions: readonly SignActionParams<unknown>[],
    ): Promise<SignActionResult[]> {
        if (!Array.isArray(actions) || actions.length === 0) {
            throw codedError('INVALID_PARAMS', 'parallel requires a non-empty actions array');
        }
        const blockedOrThrottled = this.maybeBlockedOrThrottled();
        if (blockedOrThrottled) {
            throw codedError(
                blockedOrThrottled.error,
                `MockXChainProvider: ${blockedOrThrottled.error}`,
                blockedOrThrottled,
            );
        }
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

    // The connect grant gates every per-chain read and signing method: a
    // chain outside it is refused with CHAIN_NOT_SUPPORTED.
    private isChainGranted(chainId: ChainId): boolean {
        const chains = this.grantedPermissions?.chains ?? [];
        return chains.length === 0 || chains.includes(chainId);
    }

    private assertChainGranted(chainId: ChainId): void {
        if (!this.isChainGranted(chainId)) {
            throw codedError(
                'CHAIN_NOT_SUPPORTED',
                `CHAIN_NOT_SUPPORTED: ${chainId} is outside the connect grant`,
            );
        }
    }

    // Throws NOT_CONNECTED for the methods that return a bare value rather than
    // a result object, so a dApp sees the same coded error the wallet produces.
    private assertConnected(): void {
        if (!this.connected) {
            throw codedError(
                'NOT_CONNECTED',
                'NOT_CONNECTED: MockXChainProvider is not connected',
            );
        }
    }
}
