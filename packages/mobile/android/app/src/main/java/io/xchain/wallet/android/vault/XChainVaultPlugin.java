/*
 * Copyright © 2025–2026 Dankest, LLC
 * Based on XChain Platform by Dankest, LLC - https://dankest.llc
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * This file is part of XChain Platform. Licensed under the GNU Affero
 * General Public License v3.0 or later; see LICENSE.md. A commercial
 * license (without AGPL source-disclosure terms) is available -
 * contact legal@dankest.llc.
 */

package io.xchain.wallet.android.vault;

import android.util.Base64;

import androidx.core.content.ContextCompat;
import androidx.fragment.app.FragmentActivity;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.util.Arrays;
import java.util.concurrent.Executor;

/**
 * The {@code XChainVault} bridge ( stage S2). The JS contract and its
 * reasoning live in {@code packages/web/src/storage/nativeVault.js}.
 *
 * THE BRIDGE IS THE ATTACK SURFACE. Any script running in the WebView can
 * call every registered plugin (spec §1), and this wallet renders
 * chain-derived attacker-controlled strings, so an XSS in the SPA reaches
 * these methods. That shapes what is here and what deliberately is not:
 *
 *  - No method takes a file path, a key alias, or any other name from JS.
 *    The caller cannot point this plugin at a different file or key.
 *  - No method returns the vault in plaintext, because this class never has
 *    it: what crosses the bridge is the same ciphertext IndexedDB held.
 *  - Releasing the biometric secret ALWAYS requires a fresh BiometricPrompt
 *    bound to a CryptoObject. There is no idle path to it and no
 *    "authorized for N seconds" window a script could ride.
 *
 * What this cannot do is contain an XSS that already has the user's password:
 * the SDK signs in JS, so key material transits the WebView by design. The
 * real boundary is the plugin list plus the CSP, and no native dialog here
 * should be described as containment.
 *
 * Every reply carries a status. ABSENT is a fact about the device and nothing
 * else is ever spelled that way, because the JS side turns it into the
 * create-a-new-wallet screen.
 */
@CapacitorPlugin(name = "XChainVault")
public class XChainVaultPlugin extends Plugin {

    private VaultStore vaultStore;
    private VaultStore metaStore;
    private VaultStore guardStore;
    private VaultBiometricSidecar sidecar;

    @Override
    public void load() {
        File dir = new File(getContext().getFilesDir(), "xchain-vault");
        vaultStore = new VaultStore(dir, "vault.bin", "xchain.wallet.vault.v1");
        metaStore = new VaultStore(dir, "meta.json.bin", "xchain.wallet.meta.v1");
        guardStore = new VaultStore(dir, "guards.json.bin", "xchain.wallet.guards.v1");
        sidecar = new VaultBiometricSidecar(getContext(), dir);
    }

    // -----------------------------------------------------------------
    // Vault blob
    // -----------------------------------------------------------------

    @PluginMethod
    public void loadVault(PluginCall call) {
        respondRead(call, vaultStore.read());
    }

    @PluginMethod
    public void saveVault(PluginCall call) {
        respondWrite(call, vaultStore);
    }

    @PluginMethod
    public void clearVault(PluginCall call) {
        vaultStore.clear();
        call.resolve(ok());
    }

    // -----------------------------------------------------------------
    // kdfParams meta
    // -----------------------------------------------------------------

    @PluginMethod
    public void loadMeta(PluginCall call) {
        respondRead(call, metaStore.read());
    }

    @PluginMethod
    public void saveMeta(PluginCall call) {
        respondWrite(call, metaStore);
    }

    @PluginMethod
    public void clearMeta(PluginCall call) {
        metaStore.clear();
        call.resolve(ok());
    }

    // -----------------------------------------------------------------
    // Guards (SSC-7: lockout ladder, duress hash, panic freeze)
    //
    // Read on the Locked screen, before the vault password exists, so they
    // cannot live in the vault; and not in WebView storage either, because
    // every one of them fails SILENTLY when that store is cleared or evicted
    // ( §3). Their own slot rather than a corner of the meta record,
    // so a guard write can never corrupt the kdfParams a wallet needs to open.
    // -----------------------------------------------------------------

    @PluginMethod
    public void loadGuards(PluginCall call) {
        respondRead(call, guardStore.read());
    }

    @PluginMethod
    public void saveGuards(PluginCall call) {
        respondWrite(call, guardStore);
    }

    @PluginMethod
    public void clearGuards(PluginCall call) {
        guardStore.clear();
        call.resolve(ok());
    }

    // -----------------------------------------------------------------
    // Biometric sidecar
    // -----------------------------------------------------------------

    @PluginMethod
    public void biometricStatus(PluginCall call) {
        VaultBiometricSidecar.Status status = sidecar.status();
        JSObject reply = new JSObject();
        reply.put("status", "OK");
        reply.put("available", status.available);
        reply.put("enrolled", status.enrolled);
        reply.put("detail", status.detail);
        // : the code is what the JS maps to plain language; `detail`
        // stays a developer string and is never shown to a user.
        reply.put("reasonCode", status.reasonCode);
        reply.put("mechanism", status.mechanism);
        call.resolve(reply);
    }

    @PluginMethod
    public void biometricEnroll(final PluginCall call) {
        final byte[] secret = decodeArg(call, "secret");
        if (secret == null) return;
        final FragmentActivity host = requireFragmentActivity(call);
        if (host == null) {
            Arrays.fill(secret, (byte) 0);
            return;
        }
        final Executor executor = ContextCompat.getMainExecutor(getContext());
        host.runOnUiThread(() -> sidecar.enroll(host, executor, secret, (ok, detail) -> {
            if (ok) {
                call.resolve(ok());
            } else {
                JSObject reply = new JSObject();
                reply.put("status", "LOCKED");
                reply.put("detail", detail);
                call.resolve(reply);
            }
        }));
    }

    @PluginMethod
    public void biometricUnlock(final PluginCall call) {
        final FragmentActivity host = requireFragmentActivity(call);
        if (host == null) return;
        final Executor executor = ContextCompat.getMainExecutor(getContext());
        host.runOnUiThread(() -> sidecar.unlock(host, executor, (secret, status, detail) -> {
            JSObject reply = new JSObject();
            reply.put("status", status);
            reply.put("detail", detail);
            if (secret != null) {
                reply.put("secret", Base64.encodeToString(secret, Base64.NO_WRAP));
                Arrays.fill(secret, (byte) 0);
            }
            call.resolve(reply);
        }));
    }

    @PluginMethod
    public void biometricClear(PluginCall call) {
        sidecar.clear();
        call.resolve(ok());
    }

    // -----------------------------------------------------------------
    // Screenshot protection (§1)
    // -----------------------------------------------------------------

    /**
     * Turn FLAG_SECURE on or off for the whole window.
     *
     * ROUTE-SCOPED, NOT APP-WIDE, and the scoping is the interesting part.
     * On for the seed phrase, key export and the unlock screen: those are
     * the screens where a screenshot - or the recents thumbnail Android
     * writes to disk on every app switch - is a copy of the wallet.
     * Off everywhere else, because screenshotting your own receive QR is
     * ordinary wallet use, and an app-wide flag would also blank the screen
     * for a user trying to share a support session.
     *
     * The JS side owns which routes those are (screenGuard.js); this method
     * is the switch, not the policy. It is idempotent and safe to call from
     * a React effect's cleanup.
     */
    @PluginMethod
    public void setScreenProtected(PluginCall call) {
        final boolean on = Boolean.TRUE.equals(call.getBoolean("protected", Boolean.FALSE));
        final android.app.Activity host = getActivity();
        if (host == null) {
            call.resolve(ok());
            return;
        }
        host.runOnUiThread(() -> {
            if (on) {
                host.getWindow().setFlags(
                        android.view.WindowManager.LayoutParams.FLAG_SECURE,
                        android.view.WindowManager.LayoutParams.FLAG_SECURE);
            } else {
                host.getWindow().clearFlags(
                        android.view.WindowManager.LayoutParams.FLAG_SECURE);
            }
            call.resolve(ok());
        });
    }

    // -----------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------

    private void respondRead(PluginCall call, VaultReadResult result) {
        JSObject reply = new JSObject();
        reply.put("status", result.kind.name());
        if (result.kind == VaultReadResult.Kind.OK) {
            reply.put("blob", Base64.encodeToString(result.payload, Base64.NO_WRAP));
        } else if (result.detail != null) {
            reply.put("detail", result.detail);
        }
        call.resolve(reply);
    }

    private void respondWrite(PluginCall call, VaultStore store) {
        byte[] payload = decodeArg(call, "blob");
        if (payload == null) return;
        String refusal = store.write(payload);
        Arrays.fill(payload, (byte) 0);
        if (refusal == null) {
            call.resolve(ok());
            return;
        }
        // A refusal is NOT a rejected call: the JS side needs to tell "would
        // not" from "crashed", and only the former means the previous vault is
        // still intact and still the one on disk.
        JSObject reply = new JSObject();
        reply.put("status", "LOCKED");
        reply.put("detail", refusal);
        call.resolve(reply);
    }

    /** Base64 argument to bytes, rejecting the call on anything malformed. */
    private byte[] decodeArg(PluginCall call, String name) {
        String raw = call.getString(name);
        if (raw == null || raw.isEmpty()) {
            call.reject(name + " is required");
            return null;
        }
        try {
            return Base64.decode(raw, Base64.NO_WRAP);
        } catch (IllegalArgumentException e) {
            call.reject(name + " is not valid base64");
            return null;
        }
    }

    /**
     * BiometricPrompt needs a FragmentActivity. Capacitor's BridgeActivity is
     * one; a shell that ever changed that would otherwise fail at the prompt
     * with a ClassCastException in front of the user.
     */
    private FragmentActivity requireFragmentActivity(PluginCall call) {
        android.app.Activity current = getActivity();
        if (!(current instanceof FragmentActivity)) {
            JSObject reply = new JSObject();
            reply.put("status", "LOCKED");
            reply.put("detail", "biometric prompt needs a FragmentActivity host");
            call.resolve(reply);
            return null;
        }
        return (FragmentActivity) current;
    }

    private JSObject ok() {
        JSObject reply = new JSObject();
        reply.put("status", "OK");
        return reply;
    }
}
