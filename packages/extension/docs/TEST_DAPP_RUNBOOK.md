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

Open http://localhost:5500 in the browser - any page served over http/https will have `window.xchain` injected by the content script.

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
