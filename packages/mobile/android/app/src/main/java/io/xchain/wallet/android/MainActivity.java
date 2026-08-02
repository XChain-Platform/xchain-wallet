package io.xchain.wallet.android;

import android.os.Bundle;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;

import io.xchain.wallet.android.links.XChainLinksPlugin;
import io.xchain.wallet.android.security.NoNativeHttpProxyWebViewClient;
import io.xchain.wallet.android.vault.XChainVaultPlugin;

/**
 * The app's single exported component: launcher now, deep-link target from
 * S3. Capacitor's BridgeActivity is a FragmentActivity, which is what
 * BiometricPrompt requires of its host.
 */
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Registration must happen BEFORE super.onCreate: that is where the
        // Bridge is built, and a plugin registered afterwards is missing from
        // the map the WebView sees. The symptom would not be a crash - it
        // would be the wallet quietly falling back to WebView storage, in an
        // app whose backup posture assumes the vault is in native storage.
        registerPlugin(XChainVaultPlugin.class);
        registerPlugin(XChainLinksPlugin.class);
        super.onCreate(savedInstanceState);
        dropUnusedCapacitorPlugins();
        blockNativeHttpProxy();
    }

    /**
     * SSC-1 door 2 : refuse Capacitor's native cross-origin HTTP
     * proxy, which does NOT go through the plugin registry and therefore
     * survives {@link #dropUnusedCapacitorPlugins()} entirely. The rule, the
     * measurement and the reasoning live in
     * {@link NoNativeHttpProxyWebViewClient}.
     *
     * <p>ORDERING, which is load-bearing and is better here than on iOS.
     * {@code super.onCreate} reaches {@code Bridge.create()}, which calls
     * {@code webView.loadUrl(appUrl)} - so the page load is already REQUESTED
     * by the time this runs. That is fine: {@code loadUrl} only posts to the
     * WebView's message loop, and this line runs on the same UI thread before
     * that loop is free, so the client is swapped before any resource request
     * is issued. The swap must stay on the UI thread and stay synchronous with
     * onCreate for that argument to hold.
     */
    private void blockNativeHttpProxy() {
        Bridge bridge = getBridge();
        if (bridge == null) {
            throw new IllegalStateException(
                "SSC-1: no bridge after super.onCreate; cannot block the native HTTP proxy."
            );
        }
        bridge.setWebViewClient(new NoNativeHttpProxyWebViewClient(bridge));

        // Assert the swap took. Setting a client that something later replaces
        // would look exactly like success, and the failure mode is a wallet
        // shipping a working cross-origin proxy behind its own CSP.
        if (!(bridge.getWebViewClient() instanceof NoNativeHttpProxyWebViewClient)) {
            throw new IllegalStateException(
                "SSC-1: the WebViewClient did not stay swapped; the native HTTP"
                    + " proxy is still reachable. A Capacitor upgrade has changed"
                    + " how the client is installed; re-do this rather than shipping it."
            );
        }
    }

    /**
     * Plugins Capacitor registers for us, that this app does not use (SSC-1).
     *
     * MEASURED ON AN API 36 EMULATOR, 2026-08-01, from ordinary page script:
     * {@code Capacitor.Plugins.CapacitorHttp.request({url, method})} returned
     * HTTP 200 with a response body from a third-party origin. That request is
     * made by the NATIVE stack, so the WebView's Content-Security-Policy does
     * not apply to it at all - not its {@code connect-src}, not any future
     * tightening of it. {@code CapacitorCookies} is callable the same way.
     *
     * SSC-1's rule is "register ONLY the plugins actually used", and the
     * reasoning is spelled out there: any script in the webview can call every
     * registered plugin, and the wallet renders chain-derived attacker
     * controlled strings, so an SPA XSS is a credible path. The CSP is one of
     * the two things §1 calls the real boundary; a general-purpose native HTTP
     * client sitting behind it is a hole in the other one. This app uses
     * neither plugin: it fetches through the WebView's own {@code fetch},
     * which the CSP does govern.
     *
     * WHY REFLECTION, WHICH IS NOT A HAPPY CHOICE. Capacitor registers these
     * four in {@code Bridge.registerAllPlugins()}, which is private and
     * unconditional, and exposes no un-register API. The config switch that
     * looks like the answer is not: {@code plugins.CapacitorHttp.enabled}
     * only decides whether the JS layer PATCHES {@code fetch}/{@code XHR}
     * (verified on device: both are still native, so it is already off) and
     * has no bearing on whether the plugin method can be called.
     *
     * SystemBars and WebView are deliberately left registered: Capacitor's own
     * runtime uses them, and neither is a general-purpose capability.
     *
     * The failure is LOUD on purpose. A security control that silently stops
     * applying after a dependency bump is worse than one that was never there,
     * because the spec will still claim it. If a Capacitor upgrade renames the
     * field, this throws at startup on the first emulator run rather than
     * quietly restoring the surface.
     */
    private void dropUnusedCapacitorPlugins() {
        final String[] unused = { "CapacitorHttp", "CapacitorCookies" };

        try {
            java.lang.reflect.Field field = com.getcapacitor.Bridge.class.getDeclaredField("plugins");
            field.setAccessible(true);
            Object value = field.get(getBridge());
            if (!(value instanceof java.util.Map)) {
                throw new IllegalStateException("Bridge.plugins is no longer a Map: " + value);
            }
            @SuppressWarnings("unchecked")
            java.util.Map<String, ?> registry = (java.util.Map<String, ?>) value;
            for (String name : unused) {
                registry.remove(name);
            }
        } catch (NoSuchFieldException | IllegalAccessException e) {
            throw new IllegalStateException(
                "SSC-1: could not reach Capacitor's plugin registry to drop " +
                    java.util.Arrays.toString(unused) +
                    ". A Capacitor upgrade has changed Bridge.plugins; re-do this" +
                    " removal rather than shipping the native HTTP surface.",
                e
            );
        }

        // Assert the removal actually took, through the same lookup the
        // bridge uses to dispatch a call. Removing from the wrong map would
        // otherwise look exactly like success.
        for (String name : unused) {
            if (getBridge().getPlugin(name) != null) {
                throw new IllegalStateException(
                    "SSC-1: " + name + " is still dispatchable after removal."
                );
            }
        }
    }
}
