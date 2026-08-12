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

import android.os.Build;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyPermanentlyInvalidatedException;
import android.security.keystore.KeyProperties;

import java.io.File;
import java.io.FileOutputStream;
import java.security.KeyStore;
import java.security.UnrecoverableKeyException;

import javax.crypto.AEADBadTagException;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * File-backed store for one opaque payload, encrypted under a hardware-backed
 * AES-256-GCM key (§1, D6: in-house, not a community plugin, and not
 * the deprecated androidx.security.crypto).
 *
 * WHAT IT PROTECTS. The payload handed down from JS is ALREADY the vault
 * ciphertext, encrypted under the password-derived master key: this layer
 * never sees plaintext and is not what keeps the wallet secret from an
 * attacker who has the password. What it adds is that the bytes at rest are
 * useless off-device - a file pulled from a backup, an ADB dump, or another
 * app that finds a way out of its sandbox has an AEAD blob whose key lives in
 * the TEE and cannot be exported.
 *
 * WHY THE WRITE DANCE. With allowBackup=false this file is the only copy of
 * the vault that exists anywhere. So a save writes a temp file, fsyncs it,
 * renames it into place, and only retires the previous generation once the
 * new one has been read back - and a save is never allowed to run over a
 * payload that could not be read. A wallet that loses this file has lost
 * everything except the user's seed phrase, and the user who most needs that
 * guarantee is the one who never wrote the phrase down.
 *
 * The JVM cannot fsync a directory, so the rename's own durability is the
 * filesystem's business. What this class guarantees is ORDERING, which is
 * what the failure mode actually needs: the new payload is on disk before the
 * rename publishes it, and the old generation outlives the new one until the
 * new one is proven readable. A power loss leaves either the old vault or the
 * new one, never neither.
 */
final class VaultStore {

    private static final String ANDROID_KEYSTORE = "AndroidKeyStore";
    private static final String TRANSFORMATION = "AES/GCM/NoPadding";
    private static final int IV_BYTES = 12;
    private static final int TAG_BITS = 128;
    private static final byte FORMAT_VERSION = 1;

    private final File baseDir;
    private final String fileName;
    private final String keyAlias;

    VaultStore(File baseDir, String fileName, String keyAlias) {
        this.baseDir = baseDir;
        this.fileName = fileName;
        this.keyAlias = keyAlias;
    }

    private File file() { return new File(baseDir, fileName); }
    private File tmpFile() { return new File(baseDir, fileName + ".tmp"); }
    private File prevFile() { return new File(baseDir, fileName + ".prev"); }

    VaultReadResult read() {
        File live = file();
        if (!live.exists()) {
            // A .prev with no live file means a crash between the rename and
            // the retire, or a delete that raced one. Recovering from it is
            // the difference between a lost wallet and a hiccup.
            File prev = prevFile();
            if (prev.exists()) {
                try {
                    return decrypt(readAll(prev));
                } catch (Exception e) {
                    return VaultReadResult.corrupt(describe(e));
                }
            }
            return VaultReadResult.absent();
        }
        try {
            return decrypt(readAll(live));
        } catch (Exception e) {
            return VaultReadResult.corrupt(describe(e));
        }
    }

    boolean exists() {
        return file().exists() || prevFile().exists();
    }

    /**
     * Persist a payload.
     *
     * @return null on success, otherwise a human-readable refusal. A refusal
     *         means nothing on disk changed, which is the property the caller
     *         needs in order to tell the user their vault is still intact.
     */
    String write(byte[] payload) {
        // Overwriting a blob we cannot currently read would turn a recoverable
        // keystore problem (device locked, transient TEE error) into a
        // destroyed wallet. Refuse instead.
        if (!read().isReadable()) {
            return "refusing to overwrite a vault that cannot currently be read";
        }
        //noinspection ResultOfMethodCallIgnored
        baseDir.mkdirs();

        byte[] sealed;
        try {
            sealed = encrypt(payload);
        } catch (KeyPermanentlyInvalidatedException e) {
            return "keystore key invalidated: " + describe(e);
        } catch (Exception e) {
            return "encrypt failed: " + describe(e);
        }

        File tmp = tmpFile();
        try (FileOutputStream out = new FileOutputStream(tmp)) {
            out.write(sealed);
            out.flush();
            out.getFD().sync();   // bytes down before the rename publishes them
        } catch (Exception e) {
            //noinspection ResultOfMethodCallIgnored
            tmp.delete();
            return "could not write the vault: " + describe(e);
        }

        File live = file();
        File prev = prevFile();
        if (live.exists()) {
            //noinspection ResultOfMethodCallIgnored
            prev.delete();
            //noinspection ResultOfMethodCallIgnored
            live.renameTo(prev);
        }
        if (!tmp.renameTo(live)) {
            //noinspection ResultOfMethodCallIgnored
            tmp.delete();
            // Put the previous generation back: a failed publish must not
            // leave the vault missing.
            if (prev.exists() && !live.exists()) {
                //noinspection ResultOfMethodCallIgnored
                prev.renameTo(live);
            }
            return "atomic rename failed";
        }

        // Only now is the previous generation expendable, and only if the new
        // one really reads back. If it does not, .prev stays: it is the last
        // intact vault on the device.
        if (read().kind == VaultReadResult.Kind.OK) {
            //noinspection ResultOfMethodCallIgnored
            prev.delete();
        }
        return null;
    }

    void clear() {
        for (File f : new File[] { file(), tmpFile(), prevFile() }) {
            if (f.exists()) {
                //noinspection ResultOfMethodCallIgnored
                f.delete();
            }
        }
        // The key outlives the files on purpose: deleting the alias here would
        // race any in-flight read, and a fresh key is generated lazily on the
        // next write anyway. Nothing it could decrypt remains on disk.
    }

    // -----------------------------------------------------------------
    // Crypto
    // -----------------------------------------------------------------
    //
    // Framing: [1 byte version][12 byte IV][ciphertext||GCM tag]. The version
    // byte is what makes a future format change detectable rather than
    // silently mis-parsed as corruption.

    private byte[] encrypt(byte[] plain) throws Exception {
        Cipher cipher = Cipher.getInstance(TRANSFORMATION);
        cipher.init(Cipher.ENCRYPT_MODE, orCreateKey());
        byte[] iv = cipher.getIV();
        if (iv == null || iv.length != IV_BYTES) {
            throw new IllegalStateException("unexpected GCM IV length");
        }
        byte[] body = cipher.doFinal(plain);
        byte[] out = new byte[1 + IV_BYTES + body.length];
        out[0] = FORMAT_VERSION;
        System.arraycopy(iv, 0, out, 1, IV_BYTES);
        System.arraycopy(body, 0, out, 1 + IV_BYTES, body.length);
        return out;
    }

    private VaultReadResult decrypt(byte[] sealed) {
        if (sealed.length <= 1 + IV_BYTES) {
            return VaultReadResult.corrupt("stored vault is too short to be valid");
        }
        if (sealed[0] != FORMAT_VERSION) {
            return VaultReadResult.corrupt("unknown vault format version " + sealed[0]);
        }
        SecretKey key;
        try {
            key = existingKey();
        } catch (UnrecoverableKeyException e) {
            // The key exists but cannot be handed over right now: this is the
            // temporary case, and calling it corruption would tell a user with
            // an intact wallet that it is damaged.
            return VaultReadResult.locked("keystore key is not available right now");
        } catch (Exception e) {
            return VaultReadResult.locked("keystore unavailable: " + describe(e));
        }
        if (key == null) {
            // File present, key gone: an uninstall/reinstall or a wiped
            // keystore. Unrecoverable, but NOT absence - the user still has a
            // wallet on paper and must be told this one is unreadable.
            return VaultReadResult.corrupt("vault file present but its keystore key is gone");
        }

        byte[] iv = new byte[IV_BYTES];
        System.arraycopy(sealed, 1, iv, 0, IV_BYTES);
        byte[] body = new byte[sealed.length - 1 - IV_BYTES];
        System.arraycopy(sealed, 1 + IV_BYTES, body, 0, body.length);

        try {
            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(TAG_BITS, iv));
            return VaultReadResult.ok(cipher.doFinal(body));
        } catch (AEADBadTagException e) {
            // Authentication failure: altered, truncated, or written under a
            // different key. Never "absent".
            return VaultReadResult.corrupt("vault failed its integrity check");
        } catch (KeyPermanentlyInvalidatedException e) {
            return VaultReadResult.corrupt("keystore key was invalidated: " + describe(e));
        } catch (Exception e) {
            // No UnrecoverableKeyException clause here: it is thrown when the
            // key is FETCHED, not when a cipher is initialized with one, so
            // javac rejects catching it around this block. It is handled where
            // existingKey() is called above, and mapped to LOCKED there.
            // setUnlockedDeviceRequired makes decryption fail while the screen
            // is locked. Locked, not corrupt: the vault is fine, the moment is
            // wrong, and the user must not be told their wallet is damaged.
            if (looksLikeDeviceLocked(e)) {
                return VaultReadResult.locked(describe(e));
            }
            return VaultReadResult.corrupt(describe(e));
        }
    }

    private KeyStore keyStore() throws Exception {
        KeyStore ks = KeyStore.getInstance(ANDROID_KEYSTORE);
        ks.load(null);
        return ks;
    }

    private SecretKey existingKey() throws Exception {
        java.security.Key key = keyStore().getKey(keyAlias, null);
        return (key instanceof SecretKey) ? (SecretKey) key : null;
    }

    private SecretKey orCreateKey() throws Exception {
        SecretKey existing = existingKey();
        if (existing != null) return existing;

        KeyGenParameterSpec.Builder builder = new KeyGenParameterSpec.Builder(
                keyAlias,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                // No user authentication on THIS key. The payload is already
                // encrypted under the user's password, and requiring a prompt
                // to read it would put a biometric gate in front of the "does
                // a wallet exist here" check that runs before any UI.
                .setUserAuthenticationRequired(false);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            // Ciphertext at rest is unreadable while the screen is locked.
            // Cheap, and it closes the window in which a seized-but-locked
            // device could be made to decrypt its own vault file.
            builder.setUnlockedDeviceRequired(true);
        }
        KeyGenerator generator =
                KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE);
        generator.init(builder.build());
        return generator.generateKey();
    }

    private static byte[] readAll(File f) throws Exception {
        try (java.io.FileInputStream in = new java.io.FileInputStream(f)) {
            java.io.ByteArrayOutputStream buf = new java.io.ByteArrayOutputStream();
            byte[] chunk = new byte[8192];
            int n;
            while ((n = in.read(chunk)) > 0) buf.write(chunk, 0, n);
            return buf.toByteArray();
        }
    }

    private static boolean looksLikeDeviceLocked(Exception e) {
        String text = (e.getMessage() == null ? "" : e.getMessage()) + " " + e.getClass().getName();
        String lower = text.toLowerCase();
        return lower.contains("usernotauthenticated")
                || lower.contains("device is locked")
                || lower.contains("keystore operation failed");
    }

    private static String describe(Exception e) {
        return e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName();
    }
}
