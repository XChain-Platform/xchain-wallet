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

import org.bouncycastle.crypto.generators.Argon2BytesGenerator;
import org.bouncycastle.crypto.params.Argon2Parameters;

import java.util.Arrays;

/**
 * Argon2id key derivation for {@code XChainVault.argon2id}, kept free of
 * android.* so the JVM unit test runs the exact code the plugin runs.
 *
 * Every wallet on disk was encrypted with a key from the JavaScript
 * implementation, so this must reproduce it byte for byte: Argon2id, version
 * 0x13, no secret, no associated data, password as WHATWG UTF-8.
 */
public final class Argon2idKdf {

    public static final int MIN_ITERATIONS = 1;
    public static final int MAX_ITERATIONS = 64;
    public static final int MIN_PARALLELISM = 1;
    public static final int MAX_PARALLELISM = 8;
    public static final int MAX_MEMORY_KIB = 1048576;
    public static final int MIN_LENGTH = 4;
    public static final int MAX_LENGTH = 64;
    public static final int MIN_SALT_BYTES = 8;

    private Argon2idKdf() {}

    /**
     * Check every bound before anything is allocated.
     *
     * @return null when the inputs are acceptable, else a short reason that
     *     names the option and never its value
     */
    public static String checkBounds(int iterations, int memoryKib, int parallelism, int length, int saltBytes) {
        // Iterations: at least one pass, and a ceiling so a script cannot pin the CPU for minutes.
        if (iterations < MIN_ITERATIONS || iterations > MAX_ITERATIONS) {
            return "iterations out of range";
        }
        // Parallelism first, because the memory floor depends on it.
        if (parallelism < MIN_PARALLELISM || parallelism > MAX_PARALLELISM) {
            return "parallelism out of range";
        }
        // Memory: Argon2 needs 8 KiB per lane; the 1 GiB ceiling bounds what one call may allocate.
        if (memoryKib < 8 * parallelism || memoryKib > MAX_MEMORY_KIB) {
            return "memoryKib out of range";
        }
        // Output length: the wallet asks for 32 bytes; anything from 4 to 64 is accepted.
        if (length < MIN_LENGTH || length > MAX_LENGTH) {
            return "length out of range";
        }
        // Salt: under 8 bytes is below the Argon2 minimum.
        if (saltBytes < MIN_SALT_BYTES) {
            return "salt must be at least 8 bytes";
        }
        return null;
    }

    /**
     * Derive {@code length} bytes. The caller owns {@code password} and
     * {@code salt} and zeroes them; the returned array is the caller's to zero.
     *
     * @throws IllegalArgumentException when a bound is exceeded
     */
    public static byte[] derive(byte[] password, byte[] salt, int iterations, int memoryKib, int parallelism, int length) {
        // Both byte arrays are required; an empty password is still a password.
        if (password == null || salt == null) {
            throw new IllegalArgumentException("password and salt are required");
        }
        String refusal = checkBounds(iterations, memoryKib, parallelism, length, salt.length);
        if (refusal != null) {
            throw new IllegalArgumentException(refusal);
        }
        Argon2Parameters params = new Argon2Parameters.Builder(Argon2Parameters.ARGON2_id)
                .withVersion(Argon2Parameters.ARGON2_VERSION_13)
                .withSalt(salt)
                .withIterations(iterations)
                .withMemoryAsKB(memoryKib)
                .withParallelism(parallelism)
                .build();
        Argon2BytesGenerator generator = new Argon2BytesGenerator();
        byte[] out = new byte[length];
        try {
            generator.init(params);
            // The generator clears its own memory blocks when it finishes.
            generator.generateBytes(password, out);
            return out;
        } catch (RuntimeException | Error e) {
            Arrays.fill(out, (byte) 0);
            throw e;
        } finally {
            // Drop the parameter object's copy of the salt.
            params.clear();
        }
    }

    /**
     * Encode a string the way JavaScript's TextEncoder does.
     *
     * Java's String.getBytes(UTF_8) writes '?' for an unpaired surrogate where
     * TextEncoder writes U+FFFD, and that one byte would derive a different key.
     */
    public static byte[] utf8(String text) {
        // Size the array exactly first, so no growable buffer is left holding the password.
        byte[] out = new byte[encode(text, null)];
        encode(text, out);
        return out;
    }

    /** Write text as UTF-8 into out, or only count when out is null; returns the byte count. */
    private static int encode(String text, byte[] out) {
        int n = 0;
        int i = 0;
        while (i < text.length()) {
            int cp = text.codePointAt(i);
            i += Character.charCount(cp);
            // An unpaired surrogate becomes the replacement character, as in TextEncoder.
            if (cp >= 0xD800 && cp <= 0xDFFF) {
                cp = 0xFFFD;
            }
            if (cp < 0x80) {
                n = put(out, n, cp);
            } else if (cp < 0x800) {
                n = put(out, n, 0xC0 | (cp >> 6));
                n = put(out, n, 0x80 | (cp & 0x3F));
            } else if (cp < 0x10000) {
                n = put(out, n, 0xE0 | (cp >> 12));
                n = put(out, n, 0x80 | ((cp >> 6) & 0x3F));
                n = put(out, n, 0x80 | (cp & 0x3F));
            } else {
                n = put(out, n, 0xF0 | (cp >> 18));
                n = put(out, n, 0x80 | ((cp >> 12) & 0x3F));
                n = put(out, n, 0x80 | ((cp >> 6) & 0x3F));
                n = put(out, n, 0x80 | (cp & 0x3F));
            }
        }
        return n;
    }

    private static int put(byte[] out, int n, int b) {
        if (out != null) {
            out[n] = (byte) b;
        }
        return n + 1;
    }
}
