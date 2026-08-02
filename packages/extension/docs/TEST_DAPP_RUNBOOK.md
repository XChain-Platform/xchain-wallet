# Test-dApp runbook

Manual smoke pass for the §43 dApp bridge - exercises the full Phase-1 surface against a real Chrome profile with the packaged extension loaded. Complements `packages/core/test/bridge-e2e.smoke.js` which covers the background-side flow in Node; this runbook is the equivalent end-to-end trip through the live browser UI.

Run this before tagging a Phase-1 release candidate and after any change that touches: bridge handlers, ApprovalBroker, approval screens, content script / inject script, MessageHost wiring.

## Prereqs

- Node 18+ and pnpm 9 installed (matches `packages/*/package.json` `packageManager`).
- A regtest XChain stack running (`xchain-node regtest` from the monorepo root) so `bitcoin-regtest` endpoints at `http://localhost:18081/18082/18000` respond.
- A Chromium-family browser - Chrome / Edge / Brave / Arc all work; MV3 contract is the same.

## 1. Build and load the extension

```bash
pnpm install
pnpm -C packages/extension build
```

Artifacts land in `packages/extension/dist/`:

- `manifest.json`
- `background.js`, `content/contentScript.js`, `inject/xchainProvider.js`
- `popup.html` + `approval.html` + hashed JS in `assets/`
- `icons/icon-{16,32,48,128}.png`

In the browser:

1. Open `chrome://extensions`.
2. Toggle **Developer mode** on.
3. Click **Load unpacked** and select `packages/extension/dist/`.
4. Pin the XChain Wallet action icon so the popup is one click away.

## 2. Seed a wallet (bootstrap)

Phase 1's onboarding flow lands in Batch 4. Until then, seed a wallet for the test-dApp run through the extension's DevTools:

1. Right-click the action icon → **Inspect popup** → open **Application → Storage** on the service worker.
2. Confirm `chrome.storage.local` has `xchain-wallet:vault` and `xchain-wallet:vault-meta` entries. If not, use the piece-5 unlock smoke's setUpVault helper as a template to plant a real AES-GCM blob under a known password, or skip to §4 and run a headless smoke instead.

This ugly step goes away once piece 11+ ships onboarding.

## 3. Serve the test-dApp

```bash
pnpm -C packages/test-dapp build   # if a build script is configured
# or, for a quick harness:
npx http-server packages/test-dapp -p 5500
```

Open http://localhost:5500 in the browser. `window.xchain` is injected there because the content script matches exactly these three patterns, and no others:

```
https://*/*
http://localhost/*
http://127.0.0.1/*
```

**Corrected 2026-08-02.** This line used to say "any page served over http/https", which stopped being true on 2026-07-31 when the operator narrowed the content-script scope ( D6) to delete the plain-HTTP injection surface. The instruction above still works because loopback is exempt, so the staleness was invisible.

**The trap this leaves, and it bites at the worst moment.** Spec §4's rollout exit criteria require driving connect and sign against this test dApp from a store-installed build **on at least two machines**. The obvious way to test from a second machine is to point it at the first machine's server by LAN address, and `http://192.168.x.x:5500` is neither `localhost` nor `127.0.0.1`, so the content script does not run, `window.xchain` never appears, and it reads exactly like a wallet bug. That is the same symptom D6 produced in `test/e2e/tests/cosigner/cosign-approval.extension.spec.js`, where the spec's own comment blamed the wallet. Serve the dApp on the machine you are testing from, or put it behind TLS. Do not widen the manifest to fix a test setup: widening triggers CWS re-review and can disable the extension for installed users until they re-accept.

The three patterns above are set-compared against `packages/extension/manifest.json` by `test/smoke/audits/extension-provider-origins.smoke.js`, so this list cannot go stale again.

## 4. Run through `runExample`

`packages/test-dapp/src/example.ts` is the golden path dApp author flow. A minimal runner page:

```html
<!DOCTYPE html>
<script type="module">
    import { runExample } from '/src/index.ts';
    document.querySelector('#go').addEventListener('click', async () => {
        document.querySelector('#report').textContent =
            JSON.stringify(await runExample(), null, 2);
    });
</script>
<button id="go">Run test</button>
<pre id="report"></pre>
```

Click **Run test** and walk through the approval popups that open:

| Stage | What happens | You should see |
|---|---|---|
| `provider.connect` | Approval popup opens | Connection request screen with `localhost:5500` and a chain picker. Select **Bitcoin (regtest)** and click **Connect**. |
| `provider.getActiveChains` / `getAddresses` / `getBalances` | Silent reads | Report shows `accountCount > 0`. Balances will error (stubbed SDK) but the call must not hang. |
| `provider.signIn` | Approval popup opens | Sign-in screen with the appId + nonce. Enter your wallet password and click **Approve**. `signInOk` → `true`. |
| `provider.signMessage` | Approval popup opens | Sign-message screen showing the plaintext. Enter password → **Approve**. `signMessageOk` → `true`. |
| `provider.signAction` SEND | Approval popup opens | Sign-action screen with `SEND` + params JSON. Enter password → **Approve**. Currently errors on the stubbed SDK (no real broadcast); expected until real SDK lands. `sendTxid` stays `undefined`. |
| `provider.signAction` ISSUE | **No popup** | Report shows `issueRejectedAsUnsupported: true`. The bridge returns `{ error: 'UNSUPPORTED_ACTION', supportedActions: ['SEND', 'SWEEP'] }` directly. |
| `provider.disconnect` | Silent | ConnectedSite removed from the vault. A fresh `connect` will prompt again. |

## 5. Edge cases worth clicking

- **Reject in the popup** - the dApp promise rejects with `USER_REJECTED`. Verify the error surface in the report.
- **Close the approval window** (X button) - same effect as reject.
- **Re-connect** - second `connect` on the same origin is idempotent. No popup; promise resolves immediately with existing permissions.
- **Toggle "Always allow on this origin"** on the signAction screen - next SEND from the same origin skips the approval popup entirely.
- **Lock the wallet** (popup header) mid-flow - subsequent bridge calls should fail with a "vault not ready" error, not hang. Unlock in the popup, then retry from the dApp side.

## 6. What's covered by the node smoke

`packages/core/test/bridge-e2e.smoke.js` exercises everything in §4 except the actual popup UI button clicks. It simulates the popup by calling `approval.resolve` directly with the same result envelopes the popup produces. If you're just verifying that a bridge-handler change didn't break the envelope shape, that smoke is enough and you can skip the manual run. Run this runbook before tagging RC builds where the UI + extension-load path matters.
