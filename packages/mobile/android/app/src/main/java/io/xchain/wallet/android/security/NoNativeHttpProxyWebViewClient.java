package io.xchain.wallet.android.security;

import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;

import java.io.ByteArrayInputStream;
import java.util.Collections;

/**
 * SSC-1 / : refuse Capacitor's native cross-origin HTTP proxy.
 *
 * <p>WHAT THIS BLOCKS, measured on an API 36 emulator 2026-08-01 from ordinary
 * page script, before this class existed:
 *
 * <pre>
 *   fetch('/_capacitor_http_interceptor_?u=' + encodeURIComponent('https://example.com/'))
 *   -&gt; status 200, 559 bytes, containing the target's real body
 * </pre>
 *
 * <p>{@link com.getcapacitor.WebViewLocalServer#shouldInterceptRequest} checks
 * that path prefix BEFORE it consults its own URI matcher, pulls the target out
 * of the {@code u} query parameter, and fetches it with an
 * {@code HttpURLConnection}. Nothing gates it: not a plugin, not a config
 * switch, not the plugin registry. So the  removal of
 * {@code CapacitorHttp}/{@code CapacitorCookies} from the bridge registry left
 * this wide open, and the same measurement that proved the registry closed
 * would have kept passing.
 *
 * <p>WHY IT IS A CSP BYPASS RATHER THAN A GAP THE CSP MERELY MISSES. The URL
 * the page requests is {@code https://localhost/...} - the app's OWN origin -
 * so {@code connect-src 'self'} permits it, and no tightening short of dropping
 * {@code 'self'} could refuse it, which the SPA needs for its own assets. The
 * cross-origin request then happens natively, after the CSP has already said
 * yes. §1 calls the CSP one of the two real boundaries; this walks around it.
 *
 * <p>A JS-layer patch is NOT a control here. {@code frame-src 'self'} lets an
 * attacker create a same-origin iframe and take a fresh, unpatched
 * {@code fetch} out of its realm, which is why the verification for this class
 * fires from an iframe rather than the main realm.
 *
 * <p>WHY OVERRIDING THE CLIENT WORKS, where the iOS twin needed a
 * {@code WKContentRuleList}: on Android the interception point is reachable.
 * {@code BridgeWebViewClient.shouldInterceptRequest} is public and overridable,
 * and {@link Bridge#setWebViewClient} is public, so the refusal sits in the
 * same call the proxy would have been served from. On iOS the equivalent
 * handler is built inside a {@code final} method, which is why the two shells
 * close this the same hole in two different ways.
 *
 * <p>The refusal is a 403 with an empty body rather than a null return. Null
 * would mean "not handled", which hands the request straight back to the
 * loader; a 403 is an answer, and it is one that shows up in a caller's
 * {@code response.status} instead of looking like a network flake.
 */
public class NoNativeHttpProxyWebViewClient extends BridgeWebViewClient {

    /**
     * Both spellings. Capacitor deprecated the {@code https} one and still
     * declares it, and the two are NOT prefixes of each other, so a single
     * check on the live name would silently stop covering the alias if a future
     * version routes it again.
     */
    private static final String[] PROXY_PATHS = {
        "/_capacitor_http_interceptor_",
        "/_capacitor_https_interceptor_"
    };

    public NoNativeHttpProxyWebViewClient(Bridge bridge) {
        super(bridge);
    }

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        if (isNativeProxyRequest(request)) {
            return new WebResourceResponse(
                "text/plain",
                "utf-8",
                403,
                "Forbidden by SSC-1",
                Collections.emptyMap(),
                new ByteArrayInputStream(new byte[0])
            );
        }
        return super.shouldInterceptRequest(view, request);
    }

    /** Package-visible so the instrumentation of this rule can exercise it directly. */
    static boolean isNativeProxyRequest(WebResourceRequest request) {
        if (request == null) {
            return false;
        }
        Uri url = request.getUrl();
        if (url == null) {
            return false;
        }
        String path = url.getPath();
        if (path == null) {
            return false;
        }
        for (String proxyPath : PROXY_PATHS) {
            if (path.startsWith(proxyPath)) {
                return true;
            }
        }
        return false;
    }
}
