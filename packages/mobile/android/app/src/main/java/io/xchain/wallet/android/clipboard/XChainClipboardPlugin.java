package io.xchain.wallet.android.clipboard;

import android.content.ClipData;
import android.content.ClipDescription;
import android.content.ClipboardManager;
import android.content.Context;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.PersistableBundle;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * {@code XChainClipboard}, the Android half of SSC-4 (; contract in
 * §1.1, Android mechanics in §1).
 *
 * <p>The contract is defined once, in the SPA, at
 * packages/core/src/shared/clipboard.js. This file implements it; the iOS twin
 * (XChainClipboardPlugin.swift) implements the same two methods. Anything
 * changed here and not there is a divergence between two shells that are
 * supposed to be one wallet.
 *
 * <p>WHAT THIS IS FOR. A WebView's {@code navigator.clipboard} writes an
 * ordinary clip with no sensitivity marking, so the system's own paste preview
 * and clipboard history will happily render a seed phrase, and any foreground
 * app can read it. {@link ClipDescription#EXTRA_IS_SENSITIVE} is what tells
 * the platform not to show it (Android 13+). Android has no clipboard
 * expiry API, so the expiry half is done here: a scheduled clear that only
 * fires if the clip is still ours, which is the closest thing to iOS's
 * {@code expirationDate} the platform offers.
 *
 * <p>SSC-1 (bridge boundary) applies as it does to the vault plugin: the whole
 * surface JS can reach is a string and two scalars. No path, no URL, no class
 * name.
 */
@CapacitorPlugin(name = "XChainClipboard")
public class XChainClipboardPlugin extends Plugin {

    /** Our own clip label, so the scheduled clear can tell if the clip is still ours. */
    private static final String LABEL_SENSITIVE = "XChain Wallet (sensitive)";
    private static final String LABEL_PLAIN = "XChain Wallet";

    /** Upper bound on a sensitive clip's life, seconds. See the iOS twin. */
    private static final long MAX_SENSITIVE_TTL_SECONDS = 300L;

    private final Handler handler = new Handler(Looper.getMainLooper());

    @PluginMethod
    public void write(PluginCall call) {
        final String value = call.getString("value", "");
        final boolean sensitive = Boolean.TRUE.equals(call.getBoolean("sensitive", false));
        final double requested = call.getDouble("ttlSeconds", 60.0);

        ClipboardManager cm = clipboard();
        if (cm == null) {
            call.reject("clipboard service unavailable");
            return;
        }

        ClipData clip = ClipData.newPlainText(sensitive ? LABEL_SENSITIVE : LABEL_PLAIN, value);
        if (sensitive && Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            // Android 13+. On older releases there is no way to mark a clip
            // sensitive at all, which is a platform gap, not something to
            // paper over: the JS side is told what actually happened so the
            // shell can be honest about it rather than claiming a guarantee.
            PersistableBundle extras = new PersistableBundle();
            extras.putBoolean(ClipDescription.EXTRA_IS_SENSITIVE, true);
            clip.getDescription().setExtras(extras);
        }
        cm.setPrimaryClip(clip);

        long ttl = 0L;
        if (sensitive) {
            ttl = Math.min(Math.max((long) requested, 1L), MAX_SENSITIVE_TTL_SECONDS);
            scheduleClear(ttl);
        }

        JSObject res = new JSObject();
        res.put("ok", true);
        res.put("sensitive", sensitive);
        res.put("ttlSeconds", ttl);
        // Whether the sensitivity MARK was actually applied, as opposed to
        // requested. An Android 12 device gets `false` here, and that is a real
        // difference a reader of a privacy claim should be able to see.
        res.put(
            "marked",
            sensitive && Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
        );
        call.resolve(res);
    }

    @PluginMethod
    public void clear(PluginCall call) {
        clearIfOurs(true);
        JSObject res = new JSObject();
        res.put("ok", true);
        call.resolve(res);
    }

    /**
     * Android's stand-in for iOS's {@code expirationDate}.
     *
     * <p>Best effort by construction: the process can die first, and a JS
     * timer is no better. It is still worth doing, because the common case is
     * a user who copies a seed, pastes it into a password manager and leaves
     * the app open.
     */
    private void scheduleClear(long ttlSeconds) {
        handler.postDelayed(() -> clearIfOurs(false), ttlSeconds * 1000L);
    }

    /**
     * Clear the clipboard only when the clip on it is still the one we put
     * there. Clearing unconditionally would delete whatever the user copied
     * from another app in the meantime.
     *
     * @param force clear even if the current clip is not labelled as ours,
     *              which is what an explicit clear() from JS means: the user
     *              (or the screen they left) asked for it now.
     */
    private void clearIfOurs(boolean force) {
        ClipboardManager cm = clipboard();
        if (cm == null) return;
        if (!force) {
            ClipDescription desc = cm.getPrimaryClipDescription();
            CharSequence label = desc == null ? null : desc.getLabel();
            if (label == null || !LABEL_SENSITIVE.contentEquals(label)) return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            cm.clearPrimaryClip();
        } else {
            cm.setPrimaryClip(ClipData.newPlainText(LABEL_PLAIN, ""));
        }
    }

    private ClipboardManager clipboard() {
        Context ctx = getContext();
        if (ctx == null) return null;
        return (ClipboardManager) ctx.getSystemService(Context.CLIPBOARD_SERVICE);
    }
}
