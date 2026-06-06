// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// @xchain-wallet/bridge-spec
//
// Type definitions and reference helpers for the window.xchain dApp bridge.
// Full API surface defined in SPEC.md §43.
//
// This package is TypeScript-first so third-party dApp developers can
// consume strong types when integrating. Runtime wallet code uses
// JavaScript with JSDoc types per the rest of the XChain Platform.

// ---------------------------------------------------------------------------
// Versioning
// ---------------------------------------------------------------------------

// Semver for the bridge protocol itself, independent of wallet version.
// Minor bumps are additive (new methods); major bumps are breaking.
// Kept in sync with this package's package.json version.
export const BRIDGE_SPEC_VERSION = '0.1.0';

// Cluster F FOLLOWUP 3 — version negotiation. Versions a wallet
// claiming to implement BRIDGE_SPEC_VERSION can speak. dApps requesting
// a version outside this list get a clean BRIDGE_VERSION_MISMATCH from
// `connect`, instead of a generic error when they later call a method
// the wallet doesn't recognize.
//
// Today we ship one supported version (0.1.0). When 0.2.0 lands and the
// wallet supports both, this becomes ['0.1.0', '0.2.0']. When 0.1.0 is
// retired, drop it.
export const BRIDGE_SUPPORTED_VERSIONS: readonly string[] = ['0.1.0'];

/**
 * @returns true when the requested bridge version is one this wallet
 * supports. Empty / non-string requests pass through (the connect
 * handler will fall back to BRIDGE_SPEC_VERSION as the assumed version).
 */
export function isBridgeVersionSupported(requested: unknown): boolean {
    if (typeof requested !== 'string' || requested.length === 0) return true;
    return BRIDGE_SUPPORTED_VERSIONS.includes(requested);
}

// Version of the Sign-in with XChain challenge format (§43.6).
export const SIGN_IN_CHALLENGE_VERSION = 1;

// Default expiry window for a Sign-in challenge. Wallets refuse to sign a
// challenge whose expiresAt is in the past.
export const SIGN_IN_DEFAULT_EXPIRY_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------------------
// Core shared types
// ---------------------------------------------------------------------------

// Chain identifier as used by the XChain SDK, e.g. 'bitcoin-mainnet',
// 'dogecoin-testnet', 'litecoin-regtest'. Treated as an opaque string.
export type ChainId = string;

// Coin family — groups mainnet/testnet/regtest variants of the same chain.
export type CoinId = string;

export type NetworkKind = 'mainnet' | 'testnet' | 'regtest';

// Script format of a derived address, e.g. 'p2pkh' | 'p2wpkh' | 'p2tr'.
// Kept as a string because new chains can introduce new types without a
// bridge-spec release.
export type AddressType = string;

// Subset of ChainDescriptor (§9.7) exposed to dApps via getSupportedChains().
// Internal-only fields (default encoder/explorer/hub URLs, fee strategy,
// derivation path templates) are intentionally omitted — dApps don't need
// them and exposing them would leak wallet internals.
export interface ChainDescriptor {
    id: ChainId;
    coin: CoinId;
    displayName: string;
    networkKind: NetworkKind;
    color: string;
    icon: string;
    addressTypes: AddressType[];
    defaultAddressType: AddressType;
    supportedActions: string[];
    uriScheme: string;
}

// Account as exposed to dApps — pared down from the wallet-internal schema
// (§11.3.2). The dApp sees an opaque id + display name only; BIP44 index
// and creation timestamp are not exposed.
export interface Account {
    id: string;
    name: string;
}

// Address as exposed to dApps — pared down from §11.3.3. Derivation path
// and publicKey-of-a-watch-only are not exposed by default.
export interface Address {
    id: string;
    accountId: string | null;
    chain: CoinId;
    network: NetworkKind;
    addressType: AddressType;
    address: string;
    label: string;
}

// One balance entry: native coin OR an XChain-issued asset.
// Raw amounts are strings to preserve precision; UI formatting is the
// caller's responsibility.
export interface Balance {
    asset: string;
    assetType: 'native' | 'token';
    divisibility: number;
    confirmedRaw: string;
    unconfirmedRaw: string;
    confirmed: string;
    unconfirmed: string;
}

// ---------------------------------------------------------------------------
// Permissions model (§43.3, §11.3.5)
// ---------------------------------------------------------------------------

// Per-action-type permission:
//   'always' — wallet signs without prompting
//   'ask'    — wallet prompts every time (default)
//   'never'  — wallet rejects without prompting
export type ActionPermission = 'always' | 'ask' | 'never';

// Permission record the dApp sees after connect(). Shape mirrors
// ConnectedSite.permissions (§11.3.5) but is the dApp-visible subset.
export interface SitePermissions {
    chains: CoinId[];
    accounts: string[];
    canSignMessage: boolean;
    canSignAction: Record<string, ActionPermission>;
}

// ---------------------------------------------------------------------------
// Error codes
// ---------------------------------------------------------------------------

// Stable string codes returned in failure results. Wallets MAY include a
// human-readable `message`; dApps SHOULD branch on `error` only.
export type BridgeErrorCode =
    | 'USER_REJECTED'
    | 'NOT_CONNECTED'
    | 'WALLET_LOCKED'
    | 'CHAIN_NOT_SUPPORTED'
    | 'ACCOUNT_NOT_AUTHORIZED'
    | 'ADDRESS_NOT_AUTHORIZED'
    | 'UNSUPPORTED_ACTION'
    | 'INVALID_PARAMS'
    | 'CHALLENGE_EXPIRED'
    | 'BROADCAST_FAILED'
    | 'PANIC_MODE'
    | 'THROTTLED'
    | 'BLOCKED_BY_USER'
    | 'BRIDGE_VERSION_MISMATCH'
    | 'INTERNAL_ERROR';

export interface BridgeErrorResult {
    ok: false;
    error: BridgeErrorCode;
    message?: string;
    // Populated when `error === 'THROTTLED'`. Hints how long the dApp
    // should wait before retrying. Wallets MAY include `burst` /
    // `windowMs` to describe the active limit.
    retryAfterMs?: number;
    burst?: number;
    windowMs?: number;
}

// ---------------------------------------------------------------------------
// connect / disconnect
// ---------------------------------------------------------------------------

export interface ConnectOpts {
    // App-declared identity, shown in the approval modal (§43.4).
    appName?: string;
    appIcon?: string;
    // Chains the dApp wants to operate on. Wallet presents the user with
    // these pre-selected; user may narrow the set. Omit to let the user
    // choose from all supported chains.
    requestedChains?: CoinId[];
    // Minimum bridge-spec semver range the dApp requires (e.g. '^1.2.0').
    // Wallet warns the user if the installed wallet's bridge falls outside.
    requiredBridgeVersion?: string;
}

export interface ConnectSuccess {
    ok: true;
    version: string;
    accounts: Account[];
    chains: CoinId[];
    permissions: SitePermissions;
}

export type ConnectResult = ConnectSuccess | BridgeErrorResult;

// ---------------------------------------------------------------------------
// signMessage
// ---------------------------------------------------------------------------

export interface SignMessageParams {
    address: string;
    message: string;
    // Optional hint for the wallet's plain-English display. Purely cosmetic.
    displayLabel?: string;
}

export interface SignMessageSuccess {
    ok: true;
    address: string;
    signature: string;
    // The exact bytes the wallet signed, after any canonicalization.
    signedMessage: string;
}

export type SignMessageResult = SignMessageSuccess | BridgeErrorResult;

// ---------------------------------------------------------------------------
// signAction
// ---------------------------------------------------------------------------

// Params for a SEND action (Phase 1).
export interface SendActionParams {
    fromAddress: string;
    toAddress: string;
    asset: string;
    // Raw integer amount in base units (as a string to preserve precision).
    amountRaw: string;
    memo?: string;
}

// Params for a SWEEP action (Phase 1) — empty a source of all of one asset,
// or all assets if asset is omitted.
export interface SweepActionParams {
    fromAddress: string;
    toAddress: string;
    asset?: string;
}

// Generic SignActionParams. The `params` shape is action-specific; callers
// may narrow via the type parameter, e.g.
// `SignActionParams<SendActionParams>`.
export interface SignActionParams<TParams = Record<string, unknown>> {
    chainId: ChainId;
    action: string;
    params: TParams;
    // Optional site-supplied fee override; wallet treats as a hint and the
    // user can still adjust on the sign screen.
    feeStrategyHint?: 'low' | 'normal' | 'fast';
}

export interface SignActionSuccess {
    ok: true;
    txid: string;
    actionIndex: number;
    chainId: ChainId;
}

// Specific UNSUPPORTED_ACTION shape — includes the current supported-action
// list so dApps can surface a useful message to the user.
export interface UnsupportedActionResult {
    ok: false;
    error: 'UNSUPPORTED_ACTION';
    message?: string;
    supportedActions: string[];
}

export type SignActionResult =
    | SignActionSuccess
    | UnsupportedActionResult
    | BridgeErrorResult;

// ---------------------------------------------------------------------------
// signPsbt
// ---------------------------------------------------------------------------

export interface PsbtSigningPath {
    inputIndex: number;
    // Either an address the wallet owns, or a BIP32 derivation path.
    address?: string;
    derivationPath?: string;
    // Optional sighash override (default SIGHASH_ALL).
    sighashType?: number;
}

export interface SignPsbtParams {
    chainId: ChainId;
    psbtHex: string;
    signingPaths?: PsbtSigningPath[];
    // If true, wallet signs but does not broadcast; dApp gets back the
    // signed PSBT to combine with other cosigners. Defaults to false
    // (sign + finalize + broadcast).
    broadcast?: boolean;
}

export interface SignPsbtSuccess {
    ok: true;
    signedPsbtHex: string;
    // Present only when the wallet finalized the PSBT.
    txHex?: string;
    // Present only when the wallet broadcast the tx.
    txid?: string;
}

export type SignPsbtResult = SignPsbtSuccess | BridgeErrorResult;

// ---------------------------------------------------------------------------
// signIn — Sign-in with XChain (§43.6)
// ---------------------------------------------------------------------------

export interface SignInParams {
    appId: string;
    // Site-supplied nonce. Wallet generates one if omitted.
    nonce?: string;
    // Expiry window from now; defaults to SIGN_IN_DEFAULT_EXPIRY_MS.
    expiresInMs?: number;
    // If set, wallet restricts the address picker to these chains.
    chains?: CoinId[];
}

// Structured form of the v1 challenge. The signed bytes are the string
// produced by formatSignInChallenge() below.
export interface SignInChallengeV1 {
    version: 1;
    appId: string;
    address: string;
    nonce: string;
    // Unix epoch milliseconds.
    timestamp: number;
    expiresAt: number;
}

export interface SignInSuccess {
    ok: true;
    address: string;
    chainId: ChainId;
    challenge: string;
    challengeParts: SignInChallengeV1;
    signature: string;
}

export type SignInResult = SignInSuccess | BridgeErrorResult;

// Fixed pieces of the v1 challenge wire format.
//
// Wire format:
//   `XChain Sign-In | <appId> | <address> | <nonce> | <timestamp> | <expiresAt>`
//
// All fields are string-serialized, separated by " | ". Pipes inside any
// field are rejected at format time — dApps must supply appId/nonce values
// that do not contain the separator.
export const SIGN_IN_CHALLENGE_PREFIX = 'XChain Sign-In';
export const SIGN_IN_CHALLENGE_SEPARATOR = ' | ';

export function formatSignInChallenge(parts: SignInChallengeV1): string {
    if (parts.version !== SIGN_IN_CHALLENGE_VERSION) {
        throw new Error(
            `Unsupported sign-in challenge version: ${parts.version}`,
        );
    }
    const fields = [
        parts.appId,
        parts.address,
        parts.nonce,
        String(parts.timestamp),
        String(parts.expiresAt),
    ];
    for (const f of fields) {
        if (typeof f !== 'string' && typeof f !== 'number') {
            throw new Error('Sign-in challenge field has invalid type');
        }
        if (String(f).includes(SIGN_IN_CHALLENGE_SEPARATOR)) {
            throw new Error(
                `Sign-in challenge field contains reserved separator: ${String(f)}`,
            );
        }
    }
    return [SIGN_IN_CHALLENGE_PREFIX, ...fields].join(
        SIGN_IN_CHALLENGE_SEPARATOR,
    );
}

export function parseSignInChallenge(
    challenge: string,
): SignInChallengeV1 | null {
    const segments = challenge.split(SIGN_IN_CHALLENGE_SEPARATOR);
    if (segments.length !== 6) return null;
    const [prefix, appId, address, nonce, timestampStr, expiresAtStr] =
        segments;
    if (prefix !== SIGN_IN_CHALLENGE_PREFIX) return null;
    const timestamp = Number(timestampStr);
    const expiresAt = Number(expiresAtStr);
    if (!Number.isFinite(timestamp) || !Number.isFinite(expiresAt))
        return null;
    return {
        version: 1,
        appId,
        address,
        nonce,
        timestamp,
        expiresAt,
    };
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export interface BridgeEventMap {
    // Emitted when the set of accounts the site can see changes (e.g. user
    // revokes or grants additional accounts in Settings → Connected Sites).
    accountsChanged: (accounts: Account[]) => void;
    // Emitted when the user switches the active chain in the wallet UI.
    // Sites should re-read anything chain-scoped on change.
    chainChanged: (chainId: ChainId) => void;
    // Emitted when the site is disconnected (user action, lock, or panic
    // mode). Sites should clear session state.
    disconnect: (reason?: string) => void;
}

export type BridgeEvent = keyof BridgeEventMap;

// ---------------------------------------------------------------------------
// XChainProvider — the window.xchain object
// ---------------------------------------------------------------------------

export interface XChainProvider {
    readonly version: string;
    readonly isXChainWallet: true;

    connect(opts?: ConnectOpts): Promise<ConnectResult>;
    disconnect(): Promise<void>;

    getAccounts(): Promise<Account[]>;
    getAddresses(chainId: ChainId): Promise<Address[]>;
    getBalances(chainId: ChainId, address: string): Promise<Balance[]>;

    getSupportedChains(): Promise<ChainDescriptor[]>;
    getActiveChains(): Promise<ChainId[]>;

    signMessage(params: SignMessageParams): Promise<SignMessageResult>;
    signAction<TParams = Record<string, unknown>>(
        params: SignActionParams<TParams>,
    ): Promise<SignActionResult>;
    signPsbt(params: SignPsbtParams): Promise<SignPsbtResult>;

    signIn(params: SignInParams): Promise<SignInResult>;

    // Phase 4+. Wallet presents a grouped approval modal and signs each
    // action's sign screen in sequence. Order of the result array matches
    // the input.
    parallel(actions: SignActionParams[]): Promise<SignActionResult[]>;

    on<E extends BridgeEvent>(event: E, handler: BridgeEventMap[E]): void;
    off<E extends BridgeEvent>(event: E, handler: BridgeEventMap[E]): void;
}

// ---------------------------------------------------------------------------
// Global declaration
// ---------------------------------------------------------------------------

declare global {
    interface Window {
        xchain?: XChainProvider;
    }
}

// ---------------------------------------------------------------------------
// Reference client
// ---------------------------------------------------------------------------

export {
    PROVIDER_READY_EVENT,
    isXChainAvailable,
    getProvider,
    generateNonce,
    makeSignInParams,
    validateSignInChallenge,
} from './client.ts';
export type { GetProviderOpts } from './client.ts';
