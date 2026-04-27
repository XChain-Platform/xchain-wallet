// Layout-mode controller for the MV3 action button.
//
//   `popup`     — clicking the toolbar icon opens the wallet in a 360×600
//                 popup (Chrome's default, what we shipped first).
//   `sidepanel` — clicking the toolbar icon opens (or closes) the
//                 wallet in Chrome's side panel, à la UniSat. Great
//                 for users who want the wallet visible while they
//                 browse a dApp.
//
// User preference lives in `chrome.storage.local` under
// `xchain.layoutMode`. The value is consumed both at service-worker
// boot AND on every storage change, so a flip from the in-wallet
// settings UI takes effect instantly without a restart.
//
// Mechanics:
//   - sidepanel mode  → `chrome.action.setPopup({ popup: '' })`
//                       + `chrome.sidePanel.setPanelBehavior({
//                           openPanelOnActionClick: true })`
//                       Empty popup string makes the action button
//                       fall through to the side panel.
//   - popup mode      → `chrome.action.setPopup({ popup: 'popup.html' })`
//                       + `chrome.sidePanel.setPanelBehavior({
//                           openPanelOnActionClick: false })`
//
// The side-panel API exists in Chrome 114+. In an older browser the
// `chrome.sidePanel` namespace is undefined; we detect that and pin
// the user to popup mode silently.

const STORAGE_KEY = 'xchain.layoutMode';
const POPUP_PATH = 'popup.html';

export const LAYOUT_MODES = /** @type {const} */ (['popup', 'sidepanel']);

export function isSidePanelSupported() {
    return typeof chrome !== 'undefined' && !!chrome.sidePanel;
}

export async function readLayoutMode() {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return 'popup';
    return new Promise((resolve) => {
        chrome.storage.local.get(STORAGE_KEY, (items) => {
            const v = items?.[STORAGE_KEY];
            resolve(LAYOUT_MODES.includes(v) ? v : 'popup');
        });
    });
}

export async function writeLayoutMode(mode) {
    if (!LAYOUT_MODES.includes(mode)) {
        throw new Error(`writeLayoutMode: invalid mode ${mode}`);
    }
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
    return new Promise((resolve) => {
        chrome.storage.local.set({ [STORAGE_KEY]: mode }, () => resolve());
    });
}

/**
 * Apply the given mode to chrome.action + chrome.sidePanel. Safe to
 * call repeatedly. No-ops on browsers without sidePanel support
 * (forces popup behaviour).
 */
export async function applyLayoutMode(mode) {
    if (typeof chrome === 'undefined') return;
    const wantSide = mode === 'sidepanel' && isSidePanelSupported();
    try {
        if (wantSide) {
            // Empty popup string = action click falls through to the
            // side-panel handler we install below.
            await chrome.action.setPopup({ popup: '' });
            await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
        } else {
            await chrome.action.setPopup({ popup: POPUP_PATH });
            if (chrome.sidePanel?.setPanelBehavior) {
                await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
            }
        }
    } catch (e) {
        // Surface in console without taking down the worker — bad mode
        // shouldn't break the popup flow, which is the safe default.
        // eslint-disable-next-line no-console
        console.warn('[xchain-wallet/extension] applyLayoutMode failed:', e);
    }
}

/**
 * Wire the worker to follow user-preference changes. Returns the
 * unsubscribe function. Call this once at service-worker boot.
 */
export function attachLayoutModeListener() {
    if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return () => {};
    const onChanged = (changes, areaName) => {
        if (areaName !== 'local') return;
        const next = changes[STORAGE_KEY]?.newValue;
        if (LAYOUT_MODES.includes(next)) applyLayoutMode(next);
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
}
