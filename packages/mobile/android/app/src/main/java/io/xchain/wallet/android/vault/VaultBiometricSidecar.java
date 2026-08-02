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

import android.content.Context;
import android.os.Build;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyPermanentlyInvalidatedException;
import android.security.keystore.KeyProperties;

import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.fragment.app.FragmentActivity;

import java.io.File;
import java.io.FileOutputStream;
import java.security.KeyStore;
import java.util.Arrays;
import java.util.concurrent.Executor;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Biometric unlock shortcut ( §1, stage S2).
 *
 * WHAT IS WRAPPED: the wallet PASSWORD. This is a deliberate correction to
 * the spec's "cached copy of the vault master key". In this codebase every
 * wallet record's seed is encrypted under the password - core's SignerPool
 * re-derives each signer from it at unlock - so a sidecar holding only the
 * master key would open the vault, show balances, and then fail at the first
 * signature. The password remains the KDF root either way; biometrics change
 * only how the user re-supplies it, never how it is stretched.
 *
 * The lifecycle rules are the security content, and each exists because the
 * convenient version of it is unsafe:
 *
 *  - AUTH PER USE. setUserAuthenticationParameters(0, AUTH_BIOMETRIC_STRONG)
 *    with a CryptoObject binding, so the key is usable for exactly the one
 *    operation the user just authorized. The common tutorial pattern - a
 *    validity window in seconds - leaves a period in which any code path in
 *    the process can use the key with no prompt at all.
 *  - CLASS 3 ONLY. Weak biometrics cannot gate a Keystore key, so accepting
 *    them would silently downgrade this to an ungated key.
 *  - INVALIDATED BY ENROLLMENT. Adding a fingerprint destroys the key, so
 *    someone who can enroll their own finger on a found device still cannot
 *    open the wallet on it. The wrap becomes undecryptable and the app falls
 *    back to the password with nothing lost.
 *  - SIDECAR FILE, not a region inside the vault blob. The §11.2 storage
 *    contract has no metadata region, and the wrap must be readable BEFORE
 *    the vault can be opened, so it cannot live inside what it unlocks.
 */
final class VaultBiometricSidecar {

    private static final String ANDROID_KEYSTORE = "AndroidKeyStore";
    private static final String TRANSFORMATION = "AES/GCM/NoPadding";
    private static final String KEY_ALIAS = "xchain.wallet.biometric.v1";
    private static final String WRAP_FILE = "biometric.wrap";
    private static final int IV_BYTES = 12;
    private static final int TAG_BITS = 128;
    private static final byte FORMAT_VERSION = 1;

    /** Result of enrolling: did it happen, and if not, why. */
    interface EnrollCallback {
        void onResult(boolean ok, String detail);
    }

    /** Result of unlocking: the secret (or null), plus the wire status. */
    interface UnlockCallback {
        void onResult(byte[] secret, String status, String detail);
    }

    /**
     * What the JS side needs to describe this device to its owner .
     *
     * {@code detail} is a developer string and stays one; {@code reasonCode} is
     * the stable token the shared JS maps to plain language, so Android and
     * iOS cannot describe the same condition in two different voices. The
     * mechanism is reported rather than assumed for the same reason the copy
     * moved out of the shared component: only the device knows whether its
     * owner will present a finger or a face.
     */
    static final class Status {
        final boolean available;
        final boolean enrolled;
        final String detail;
        final String reasonCode;
        final String mechanism;

        Status(boolean available, boolean enrolled, String detail,
               String reasonCode, String mechanism) {
            this.available = available;
            this.enrolled = enrolled;
            this.detail = detail;
            this.reasonCode = reasonCode;
            this.mechanism = mechanism;
        }
    }

    private final Context context;
    private final File baseDir;

    VaultBiometricSidecar(Context context, File baseDir) {
        this.context = context;
        this.baseDir = baseDir;
    }

    private File wrapFile() { return new File(baseDir, WRAP_FILE); }

    /**
     * Whether a Class-3 biometric is usable right now, and whether a wrap is
     * held. Both halves matter: "available" decides whether the offer can be
     * made at all, "enrolled" decides whether the unlock button appears.
     */
    Status status() {
        int can = BiometricManager.from(context)
                .canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG);
        String detail;
        String reasonCode;
        switch (can) {
            case BiometricManager.BIOMETRIC_SUCCESS:
                detail = "ok";
                reasonCode = "ok";
                break;
            case BiometricManager.BIOMETRIC_ERROR_NO_HARDWARE:
                detail = "no biometric hardware";
                reasonCode = "no_hardware";
                break;
            case BiometricManager.BIOMETRIC_ERROR_HW_UNAVAILABLE:
                detail = "biometric hardware unavailable";
                reasonCode = "hw_unavailable";
                break;
            case BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED:
                detail = "no biometric enrolled";
                reasonCode = "none_enrolled";
                break;
            case BiometricManager.BIOMETRIC_ERROR_SECURITY_UPDATE_REQUIRED:
                detail = "security update required";
                reasonCode = "security_update_required";
                break;
            default:
                detail = "unsupported (" + can + ")";
                reasonCode = "unsupported";
        }
        return new Status(
                can == BiometricManager.BIOMETRIC_SUCCESS,
                wrapFile().exists(),
                detail,
                reasonCode,
                mechanism());
    }

    /**
     * What this device will actually ask its owner for, in their words.
     *
     * BiometricManager will not say which modality it would use, so the
     * sensors are the closest honest answer. Feature STRINGS rather than the
     * PackageManager constants: FEATURE_FINGERPRINT is deprecated and the
     * face/iris ones postdate this app's API 26 floor, and an unknown feature
     * string simply answers false - which is the right answer on a device
     * that has no such sensor either way.
     */
    private String mechanism() {
        android.content.pm.PackageManager pm = context.getPackageManager();
        boolean finger = pm.hasSystemFeature("android.hardware.fingerprint");
        boolean face = pm.hasSystemFeature("android.hardware.biometrics.face");
        boolean iris = pm.hasSystemFeature("android.hardware.biometrics.iris");
        if (finger && (face || iris)) return "your fingerprint or face";
        if (finger) return "your fingerprint";
        if (face) return "your face";
        if (iris) return "your eyes";
        return "your device biometric";
    }

    /**
     * Prompt, then wrap {@code secret} under a freshly generated
     * auth-per-use key.
     *
     * The prompt at enrollment is not ceremony: it proves the person enabling
     * the shortcut is the person whose biometric will later use it, on a
     * device that may be unlocked and briefly unattended.
     */
    void enroll(FragmentActivity activity, Executor executor, final byte[] secret,
                final EnrollCallback callback) {
        final SecretKey key;
        try {
            key = regenerateKey();
        } catch (Exception e) {
            Arrays.fill(secret, (byte) 0);
            callback.onResult(false, "could not create the biometric key: " + describe(e));
            return;
        }
        Cipher cipher;
        try {
            cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.ENCRYPT_MODE, key);
        } catch (KeyPermanentlyInvalidatedException e) {
            Arrays.fill(secret, (byte) 0);
            callback.onResult(false, "biometric enrollment changed; try again");
            return;
        } catch (Exception e) {
            Arrays.fill(secret, (byte) 0);
            callback.onResult(false, "could not prepare the biometric key: " + describe(e));
            return;
        }

        prompt(activity, executor, cipher,
                "Enable biometric unlock",
                "Confirm it is you before storing the unlock shortcut",
                new PromptCallback() {
                    @Override
                    public void onError(String detail) {
                        Arrays.fill(secret, (byte) 0);
                        callback.onResult(false, detail);
                    }

                    @Override
                    public void onSuccess(Cipher authorized) {
                        try {
                            writeAtomically(frame(authorized.getIV(), authorized.doFinal(secret)));
                            callback.onResult(true, "ok");
                        } catch (Exception e) {
                            callback.onResult(false, "could not store the wrap: " + describe(e));
                        } finally {
                            Arrays.fill(secret, (byte) 0);
                        }
                    }
                });
    }

    /** Prompt, then unwrap. The callback gets a null secret when it did not happen. */
    void unlock(FragmentActivity activity, Executor executor, final UnlockCallback callback) {
        File wrap = wrapFile();
        if (!wrap.exists()) {
            callback.onResult(null, "ABSENT", "no biometric wrap stored");
            return;
        }
        byte[] sealed;
        try {
            sealed = readAll(wrap);
        } catch (Exception e) {
            callback.onResult(null, "ABSENT", "wrap unreadable: " + describe(e));
            return;
        }
        if (sealed.length <= 1 + IV_BYTES || sealed[0] != FORMAT_VERSION) {
            clear();
            callback.onResult(null, "ABSENT", "wrap is malformed and has been discarded");
            return;
        }

        SecretKey key = existingKey();
        if (key == null) {
            // The key is gone (enrollment change, lock screen removed). The
            // wrap it protected is permanently undecryptable, so discard it
            // rather than leaving a button that can only ever fail.
            clear();
            callback.onResult(null, "ABSENT",
                    "biometric key was invalidated; re-enable it in Settings");
            return;
        }

        byte[] iv = new byte[IV_BYTES];
        System.arraycopy(sealed, 1, iv, 0, IV_BYTES);
        final byte[] body = new byte[sealed.length - 1 - IV_BYTES];
        System.arraycopy(sealed, 1 + IV_BYTES, body, 0, body.length);

        Cipher cipher;
        try {
            cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(TAG_BITS, iv));
        } catch (KeyPermanentlyInvalidatedException e) {
            clear();
            callback.onResult(null, "ABSENT",
                    "biometric enrollment changed; re-enable it in Settings");
            return;
        } catch (Exception e) {
            callback.onResult(null, "LOCKED", "biometric key unavailable: " + describe(e));
            return;
        }

        prompt(activity, executor, cipher,
                "Unlock XChain Wallet",
                "Use your fingerprint or face to unlock",
                new PromptCallback() {
                    @Override
                    public void onError(String detail) {
                        callback.onResult(null, "LOCKED", detail);
                    }

                    @Override
                    public void onSuccess(Cipher authorized) {
                        try {
                            callback.onResult(authorized.doFinal(body), "OK", "ok");
                        } catch (Exception e) {
                            callback.onResult(null, "LOCKED", "unwrap failed: " + describe(e));
                        }
                    }
                });
    }

    /**
     * Destroy the wrap AND the key. Called on disable, on wipe, and whenever
     * the wrap is found unusable. Deleting the key as well as the file is what
     * makes a stale wrap unable to resurrect an old password: a file recovered
     * from a forensic image has no key left to open it.
     */
    void clear() {
        File wrap = wrapFile();
        if (wrap.exists()) {
            //noinspection ResultOfMethodCallIgnored
            wrap.delete();
        }
        try {
            keyStore().deleteEntry(KEY_ALIAS);
        } catch (Exception ignored) {
            // Best-effort: the file is gone either way, and a key with nothing
            // to decrypt is inert.
        }
    }

    // -----------------------------------------------------------------

    private interface PromptCallback {
        void onError(String detail);
        void onSuccess(Cipher authorized);
    }

    private void prompt(FragmentActivity activity, Executor executor, Cipher cipher,
                        String title, String subtitle, final PromptCallback callback) {
        BiometricPrompt.PromptInfo info = new BiometricPrompt.PromptInfo.Builder()
                .setTitle(title)
                .setSubtitle(subtitle)
                // No device-credential fallback: the wallet's own password
                // form is already the fallback, and allowing the device PIN
                // here would let it stand in for the biometric the key is
                // bound to.
                .setNegativeButtonText("Cancel")
                .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
                .setConfirmationRequired(true)
                .build();

        BiometricPrompt biometricPrompt = new BiometricPrompt(activity, executor,
                new BiometricPrompt.AuthenticationCallback() {
                    @Override
                    public void onAuthenticationError(int code, CharSequence message) {
                        callback.onError(String.valueOf(message));
                    }

                    @Override
                    public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) {
                        Cipher authorized = result.getCryptoObject() == null
                                ? null
                                : result.getCryptoObject().getCipher();
                        if (authorized == null) {
                            // Without the CryptoObject the authentication
                            // proves nothing about key use. Refuse rather than
                            // fall back to the unbound cipher.
                            callback.onError("authentication returned no bound cipher");
                            return;
                        }
                        callback.onSuccess(authorized);
                    }

                    @Override
                    public void onAuthenticationFailed() {
                        // One non-matching finger. The prompt stays up and
                        // retries; nothing to report yet.
                    }
                });
        biometricPrompt.authenticate(info, new BiometricPrompt.CryptoObject(cipher));
    }

    private byte[] frame(byte[] iv, byte[] body) {
        byte[] out = new byte[1 + IV_BYTES + body.length];
        out[0] = FORMAT_VERSION;
        System.arraycopy(iv, 0, out, 1, IV_BYTES);
        System.arraycopy(body, 0, out, 1 + IV_BYTES, body.length);
        return out;
    }

    /** Same write discipline as the vault blob: temp, fsync, rename. */
    private void writeAtomically(byte[] bytes) throws Exception {
        //noinspection ResultOfMethodCallIgnored
        baseDir.mkdirs();
        File tmp = new File(baseDir, WRAP_FILE + ".tmp");
        try (FileOutputStream out = new FileOutputStream(tmp)) {
            out.write(bytes);
            out.flush();
            out.getFD().sync();
        }
        if (!tmp.renameTo(wrapFile())) {
            //noinspection ResultOfMethodCallIgnored
            tmp.delete();
            throw new IllegalStateException("could not publish the biometric wrap");
        }
    }

    private KeyStore keyStore() throws Exception {
        KeyStore ks = KeyStore.getInstance(ANDROID_KEYSTORE);
        ks.load(null);
        return ks;
    }

    private SecretKey existingKey() {
        try {
            java.security.Key key = keyStore().getKey(KEY_ALIAS, null);
            return (key instanceof SecretKey) ? (SecretKey) key : null;
        } catch (Exception e) {
            return null;
        }
    }

    /**
     * Always a FRESH key: re-enrolling replaces it rather than reusing it, so
     * an old wrap can never be opened by a key generated for a new one.
     */
    private SecretKey regenerateKey() throws Exception {
        try {
            keyStore().deleteEntry(KEY_ALIAS);
        } catch (Exception ignored) {
            // First run, or no keystore entry yet.
        }
        KeyGenParameterSpec.Builder builder = new KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .setUserAuthenticationRequired(true)
                .setInvalidatedByBiometricEnrollment(true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            // 0 seconds = authorize per use, bound to the CryptoObject.
            builder.setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG);
        } else {
            // API 26-29 have no setUserAuthenticationParameters. -1 is the
            // pre-R spelling of the same per-use requirement; it is NOT a
            // timeout in seconds, which is the mistake this branch exists to
            // avoid making.
            //noinspection deprecation
            builder.setUserAuthenticationValidityDurationSeconds(-1);
        }
        KeyGenerator generator =
                KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE);
        generator.init(builder.build());
        return generator.generateKey();
    }

    private static byte[] readAll(File f) throws Exception {
        try (java.io.FileInputStream in = new java.io.FileInputStream(f)) {
            java.io.ByteArrayOutputStream buf = new java.io.ByteArrayOutputStream();
            byte[] chunk = new byte[4096];
            int n;
            while ((n = in.read(chunk)) > 0) buf.write(chunk, 0, n);
            return buf.toByteArray();
        }
    }

    private static String describe(Exception e) {
        return e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName();
    }
}
