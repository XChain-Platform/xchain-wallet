# XChain Wallet — `window.xchain` dApp Bridge

Reference for dApp developers integrating with XChain Wallet. The bridge surface is normative in `@xchain-wallet/bridge-spec` (TypeScript); this document is the human-readable companion. Read the type definitions for ground truth — the `.ts` files cannot drift.

---

## Scope

The bridge lets a webpage:

- Detect that XChain Wallet is installed.
- Request the user's permission to read accounts and balances.
- Ask the user to sign messages, PSBTs, or XChain ACTIONs.
- Authenticate the user via Sign-In with XChain (SIWX).
- Subscribe to wallet-side events (account changes, chain switches, disconnects).

It does **not** let a dApp:

- Read the user's seed, master key, or derived private keys.
- Bypass the approval popup for any privileged operation.
- Persist anything in the wallet beyond the per-site permission record.

Approval popups are real OS-rendered windows owned by the wallet's origin (`chrome-extension://<id>/approval.html`). A page cannot forge an approval, and closing the approval window unconditionally rejects the request.

---

## Detection

The provider is available as `window.xchain` once the wallet has injected it. Detection should not assume the provider is ready immediately on `DOMContentLoaded` — the extension content script may inject after that.

```js
import { isXChainAvailable, getProvider, PROVIDER_READY_EVENT } from '@xchain-wallet/bridge-spec';

if (isXChainAvailable()) {
  const provider = window.xchain;
  // ...
} else {
  window.addEventListener(PROVIDER_READY_EVENT, () => {
    const provider = window.xchain;
    // ...
  });
}

// Or use the provided helper that handles the race:
const provider = await getProvider({ timeoutMs: 3000 });
if (!provider) { /* not installed or timed out */ }
```

Every provider exposes:

```ts
provider.version       // "0.1.0" — see "Versioning" below
provider.isXChainWallet // true
```

---

## Quick start

```js
import { getProvider, generateNonce } from '@xchain-wallet/bridge-spec';

const provider = await getProvider();
if (!provider) throw new Error('XChain Wallet not installed');

const result = await provider.connect({
  appName: 'My DApp',
  appIcon: 'https://example.com/icon.png',
  requestedChains: ['bitcoin', 'litecoin'],
});

if (!result.ok) {
  console.error('Connect rejected:', result.error);
  return;
}

console.log('connected', result.accounts, result.chains);
```

---

## Lifecycle

### `connect(opts?: ConnectOpts) → Promise<ConnectResult>`

Opens an approval popup. The user reviews the dApp's identity, requested chains, and the accounts the dApp will be able to see, then approves or rejects.

`ConnectOpts`:

| Field | Type | Description |
|---|---|---|
| `appName` | string | Display name shown on the approval modal. |
| `appIcon` | string (URL) | Icon shown alongside the name. |
| `requestedChains` | `CoinId[]` | Chains the dApp wants. User may narrow. Pre-selected, never auto-granted. |
| `requiredBridgeVersion` | semver range | Wallet warns if its bridge falls outside this range. |

`ConnectSuccess`:

```ts
{ ok: true; version: string; accounts: Account[]; chains: CoinId[]; permissions: SitePermissions }
```

Any failure returns `{ ok: false; error: BridgeErrorCode; message?: string }` — see "Error codes".

### `disconnect() → Promise<void>`

Drops the per-site permission record on the wallet side. The wallet then emits the `disconnect` event back to the provider.

---

## Read methods

| Method | Returns | Notes |
|---|---|---|
| `getAccounts()` | `Account[]` | The accounts the user authorized for this site. Empty before `connect`. |
| `getAddresses(chainId)` | `Address[]` | Addresses derived from the authorized accounts on the given chain. |
| `getBalances(chainId, address)` | `Balance[]` | Native + token balances for a single address. Raw + formatted strings; do not parse the formatted form. |
| `getSupportedChains()` | `ChainDescriptor[]` | Full chain catalogue the wallet knows about. Filter on `networkKind` if you need only mainnet. |
| `getActiveChains()` | `ChainId[]` | Chains currently selected as active in the wallet UI. |

`Balance` precision rule: `confirmedRaw` and `unconfirmedRaw` are integer base units (satoshis for BTC-family chains) as decimal strings. Use a big-number library; never parse them as JS numbers.

---

## Sign methods

### `signMessage(params: SignMessageParams) → Promise<SignMessageResult>`

User reviews the plain-text message in the approval popup and signs with the chosen address's key.

```ts
{ address: string; message: string; displayLabel?: string }
→ { ok: true; address; signature; signedMessage } | BridgeErrorResult
```

`signedMessage` may differ from the input `message` if the wallet canonicalized whitespace; verify against the returned form, not the input.

### `signAction(params: SignActionParams) → Promise<SignActionResult>`

The dApp describes an XChain ACTION (SEND, SWEEP, ISSUE, ORDER, etc.); the wallet renders a plain-English review screen, encodes the action via the SDK, signs the resulting PSBT, and broadcasts.

```ts
{ chainId; action: 'SEND'; params: SendActionParams; feeStrategyHint?: 'low' | 'normal' | 'fast' }
→ { ok: true; txid; actionIndex; chainId } | UnsupportedActionResult | BridgeErrorResult
```

`UnsupportedActionResult` includes the wallet's current `supportedActions` list — surface it to the user so they know what the wallet *can* do today. The supported set grows as the wallet matures.

The wallet always renders the user's stated `to` / `amount` / `asset` from their original input on the sign screen, independently of what the encoder produces. A malicious or buggy encoder cannot silently swap the destination — the user sees a divergence. The `feeStrategyHint` is a hint only; the user can override at the sign screen.

### `signPsbt(params: SignPsbtParams) → Promise<SignPsbtResult>`

Sign an arbitrary PSBT. The wallet derives signing inputs from `signingPaths` (or auto-detects when omitted), prompts the user, and signs.

```ts
{ chainId; psbtHex; signingPaths?; broadcast?: boolean }
→ { ok: true; signedPsbtHex; txHex?; txid? } | BridgeErrorResult
```

If `broadcast: false` (default for multisig flows where the dApp combines partial signatures), `txHex` and `txid` are absent. If `broadcast: true`, all three are populated on success.

### `signIn(params: SignInParams) → Promise<SignInResult>`

Sign-In with XChain (SIWX). The wallet asks the user to pick an address, builds a v1 challenge, signs it, and returns both the structured challenge and the signature so the dApp can verify server-side.

```ts
{ appId: string; nonce?: string; expiresInMs?: number; chains?: CoinId[] }
→ { ok: true; address; chainId; challenge; challengeParts; signature } | BridgeErrorResult
```

Wire format of the v1 challenge:

```
XChain Sign-In | <appId> | <address> | <nonce> | <timestamp> | <expiresAt>
```

All fields string-serialized, separated by ` | `. Pipes inside any field are rejected at format time. The `challenge` string is exactly what was signed; verify with `parseSignInChallenge(challenge)` and any sigtools your stack uses for the chain in question.

```js
import { generateNonce, makeSignInParams, validateSignInChallenge } from '@xchain-wallet/bridge-spec';

const params = makeSignInParams({ appId: 'mydapp.example' });
const result = await provider.signIn(params);
if (!result.ok) { /* handle error */ return; }

const validation = validateSignInChallenge(result.challenge, {
  appId: 'mydapp.example',
  expectedNonce: params.nonce,
});
if (!validation.ok) { /* reject — challenge tampered */ return; }
// Now verify result.signature against result.address per the chain's signature scheme.
```

### `parallel(actions: SignActionParams[]) → Promise<SignActionResult[]>`

Phase 4+. Cross-chain parallel composer — the wallet groups every action into one approval modal and signs them in sequence (or atomically where the chain pair supports it). The result array preserves input order; per-action results carry their own `ok` flag.

---

## Events

```js
provider.on('accountsChanged', (accounts) => { /* re-read user state */ });
provider.on('chainChanged', (chainId) => { /* re-fetch chain-scoped data */ });
provider.on('disconnect', (reason) => { /* clear session */ });

provider.off('accountsChanged', handler);
```

| Event | Payload | Fired when |
|---|---|---|
| `accountsChanged` | `Account[]` | User grants or revokes accounts to this site, or switches the active wallet. |
| `chainChanged` | `ChainId` | User switches the wallet's active chain. |
| `disconnect` | `string?` (reason) | Site is disconnected (user action, wallet locked, panic mode). |

A handler removed via `off` will not fire for events emitted after removal.

---

## Error codes

`BridgeErrorCode` is a stable string set. Branch on `result.error`, not on `result.message` (the latter is human-readable and may change).

| Code | When |
|---|---|
| `USER_REJECTED` | User clicked Reject, or closed the approval window. |
| `NOT_CONNECTED` | The site has not called `connect()` yet, or the user revoked. |
| `WALLET_LOCKED` | Wallet is locked. The user must unlock first; the wallet does not auto-prompt for unlock from a dApp request. |
| `CHAIN_NOT_SUPPORTED` | The dApp asked for a chain the wallet doesn't know about. |
| `ACCOUNT_NOT_AUTHORIZED` | The dApp passed an account it doesn't have permission for. |
| `ADDRESS_NOT_AUTHORIZED` | Same, for addresses. |
| `UNSUPPORTED_ACTION` | The action kind isn't supported on the target chain or by this wallet version. Result includes `supportedActions`. |
| `INVALID_PARAMS` | Schema validation failed — fix your call shape. |
| `CHALLENGE_EXPIRED` | The Sign-In challenge's `expiresAt` is in the past. |
| `BROADCAST_FAILED` | The wallet signed but the network rejected the broadcast. |
| `PANIC_MODE` | The user has placed the wallet in panic mode (24h signing freeze). All sign methods reject with this until the freeze lifts. |
| `THROTTLED` | The site exceeded the per-origin sign-request rate limit. Result includes `retryAfterMs` (also `burst` / `windowMs`). Connect / disconnect / read methods are not throttled — only `signMessage` / `signAction` / `signPsbt` / `signIn`. |
| `BRIDGE_VERSION_MISMATCH` | The dApp's `requiredBridgeVersion` is outside the wallet's supported range. |
| `INTERNAL_ERROR` | Catch-all for unexpected wallet-side failures. Log it, but don't try to recover programmatically. |

---

## Permissions model

When a user approves a `connect`, the wallet stores a `ConnectedSite` record:

```ts
{
  origin: string;
  permissions: {
    chains: CoinId[];
    accounts: string[];
    canSignMessage: boolean;
    canSignAction: Record<string, ActionPermission>; // 'always' | 'ask' | 'never'
  };
}
```

`canSignAction` starts empty. Per-action permission is an opt-in at sign time — if the user picks "Always allow SEND on this site", the next SEND request signs without a popup. Anything not explicitly `'always'` is `'ask'` and re-prompts.

Sites can be revoked from `Settings → Connected Sites` at any time. Revocation fires the `disconnect` event back to the provider.

---

## Versioning

`provider.version` is the bridge-spec semver, independent of the wallet release version. Minor bumps add methods or fields; major bumps are breaking. The current version constant is `BRIDGE_SPEC_VERSION` exported from `@xchain-wallet/bridge-spec`.

If you depend on a method that lands after `0.1.0`, set `requiredBridgeVersion: '^0.2.0'` in your `connect` call so users on older wallet builds see a clear "please update" banner rather than a confusing `INTERNAL_ERROR`.

---

## Reference dApp

`packages/test-dapp/` in the wallet repo exercises every method end-to-end. Use it as a copy-paste source when integrating, and as a smoke test against your own dev wallet build.

---

## Threat model crossovers

If you're building a dApp, you should also read the wallet's `docs/THREAT_MODEL.md` — particularly §2.3 (network threats) and §4.1 (malicious dApp). It describes the assumptions the wallet makes about your code so you can stay inside them.

---

Last reviewed: 2026-04-27 at v0.198.0.
