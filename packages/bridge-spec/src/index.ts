// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
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
// The RUNTIME values of this spec live in ./runtime.js and are re-exported
// here, so this stays the single public entry point. They are plain JS
// because the desktop MAIN process loads this package out of app.asar with
// no bundler, and Node refuses to strip types from anything under
// node_modules. See the header of runtime.js.
export {
    BRIDGE_SPEC_VERSION,
    BRIDGE_SUPPORTED_VERSIONS,
    isBridgeVersionSupported,
    BRIDGE_ERROR_CODES,
    isBridgeErrorCode,
    SIGN_IN_CHALLENGE_VERSION,
    SIGN_IN_DEFAULT_EXPIRY_MS,
    SIGN_IN_CHALLENGE_PREFIX,
    SIGN_IN_CHALLENGE_SEPARATOR,
    formatSignInChallenge,
    parseSignInChallenge,
} from './runtime.js';

// ---------------------------------------------------------------------------
// Core shared types
// ---------------------------------------------------------------------------

// Chain identifier as used by the XChain SDK, e.g. 'bitcoin-mainnet',
// 'dogecoin-testnet', 'litecoin-regtest'. Treated as an opaque string.
export type ChainId = string;

// Coin family - groups mainnet/testnet/regtest variants of the same chain.
export type CoinId = string;

export type NetworkKind = 'mainnet' | 'testnet' | 'regtest';

// Script format of a derived address, e.g. 'p2pkh' | 'p2wpkh' | 'p2tr'.
// Kept as a string because new chains can introduce new types without a
// bridge-spec release.
export type AddressType = string;

// Subset of ChainDescriptor (§9.7) exposed to dApps via getSupportedChains().
// Internal-only fields (default encoder/explorer/hub URLs, fee strategy,
// derivation path templates) are intentionally omitted - dApps don't need
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

// Account as exposed to dApps - pared down from the wallet-internal schema
// (§11.3.2). The dApp sees an opaque id + display name only; BIP44 index
// and creation timestamp are not exposed.
export interface Account {
    id: string;
    name: string;
}

// Address as exposed to dApps - pared down from §11.3.3. Derivation path
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
//   'always' - wallet signs without prompting
//   'ask'    - wallet prompts every time (default)
//   'never'  - wallet rejects without prompting
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
//
// This union and the `BRIDGE_ERROR_CODES` runtime array in runtime.js are one
// contract in two syntaxes. Edit them together: a wallet can only check what
// it puts on the wire against the runtime copy, and for a while it checked
// nothing at all and shipped twelve codes that are not here.
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
    // Required, like every sibling signing method: the wallet gates the request
    // on the site's per-chain permission before it prompts, and the signing
    // scheme itself is chain-specific. Omitted here, a request built from this
    // type failed MISSING_CHAIN_ID before the user ever saw an approval
    //; the type was the incomplete side, not the handler.
    chainId: ChainId;
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

// Params for a SWEEP action (Phase 1) - empty a source of all of one asset,
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
    chainId: ChainId;
    // The action's index in the XChain ledger. OPTIONAL, because a wallet
    // resolves this result the moment the transaction is BROADCAST and the
    // index is assigned later, by the indexer, once a block carries the
    // transaction. Declared required, it forced every wallet into one of two
    // lies: block the call until a confirmation arrives, or invent a number
    //. dApps that need the index look it up from `txid` against an
    // explorer once the transaction confirms; a wallet that already knows it
    // (a resubmission of an indexed action, say) still sends it.
    actionIndex?: number;
}

// Specific UNSUPPORTED_ACTION shape - includes the current supported-action
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
// coSign: MuSig2 passive co-signature (§22 / P4)
//
// An agent holding one key of a 2-of-2 MuSig2 account asks the wallet (the
// policy co-signer / daemon half) to co-sign a spend. The wallet decodes the
// action from the PSBT, ALWAYS prompts the user, and on approval returns its
// deterministic partial signature (or a structured refusal when the action is
// out of policy). On-chain the completed spend is a single Schnorr signature.

export interface CoSignParams {
    chainId: ChainId;
    // The funded 2-of-2 aggregate (P2TR) address identifying which stored
    // co-signer account this request targets.
    aggregateAddress: string;
    psbtHex: string;
    // The agent's 66-byte public nonce (hex). Single-input form.
    agentPublicNonce?: string;
    // The input this group signs (single-input form; default 0).
    inputIndex?: number;
    // Multi-input form: one { index, agentPublicNonce } per input to co-sign.
    inputs?: Array<{ index: number; agentPublicNonce: string }>;
    sighashType?: number;
}

export interface CoSignApprovedSuccess {
    ok: true;
    approved: true;
    // Single-input approval.
    publicNonce?: string;
    sig?: string;
    msg?: string;
    // Multi-input approval.
    signatures?: Array<{ index: number; publicNonce: string; sig: string; msg: string }>;
    // The action the wallet decoded from the PSBT.
    action?: string;
}

// The wallet ran and refused (out of policy, panic mode, disabled account,
// unauthorized output, etc.). Distinct from a BridgeErrorResult (protocol /
// transport failure): the request was well-formed but denied.
export interface CoSignRefused {
    ok: true;
    approved: false;
    reason: string;
    detail?: unknown;
}

export type CoSignResult = CoSignApprovedSuccess | CoSignRefused | BridgeErrorResult;

// ---------------------------------------------------------------------------
// signIn - Sign-in with XChain (§43.6)
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

// Structured form of the v2 challenge. The signed bytes are the string
// produced by formatSignInChallenge() below.
export interface SignInChallengeV2 {
    version: 2;
    appId: string;
    // Page origin as stamped by the wallet (the requesting page's
    // location.origin recorded at the trust boundary) - NOT supplied by
    // the dApp. Relying backends MUST check this equals the origin they
    // serve the dApp from; appId alone is attacker-chosen.
    origin: string;
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
    challengeParts: SignInChallengeV2;
    signature: string;
}

export type SignInResult = SignInSuccess | BridgeErrorResult;

// Fixed pieces of the v2 challenge wire format.
//
// Wire format:
//   `XChain Sign-In v2 | <appId> | <origin> | <address> | <nonce> | <timestamp> | <expiresAt>`
//
// All fields are string-serialized, separated by " | ". Pipes inside any
// field are rejected at format time - dApps must supply appId/nonce values
// that do not contain the separator. The versioned prefix lets validators
// detect the format on the wire; v1 challenges ("XChain Sign-In", no
// origin field) fail parseSignInChallenge and must be rejected.
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
// XChainProvider - the window.xchain object
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

    coSign(params: CoSignParams): Promise<CoSignResult>;

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
