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

package io.xchain.wallet.android.watch;

import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Base64;

public final class WatchImagePayload {

    private static final byte[] PNG_SIGNATURE = {
            (byte) 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a
    };
    private static final byte[] JPEG_SIGNATURE = {
            (byte) 0xff, (byte) 0xd8, (byte) 0xff
    };
    private static final char[] HEX = "0123456789abcdef".toCharArray();

    private WatchImagePayload() {}

    public static byte[] decode(String hash, String base64) {
        if (!isHash(hash) || base64 == null) {
            return null;
        }

        byte[] bytes;
        try {
            bytes = Base64.getDecoder().decode(base64);
        } catch (IllegalArgumentException error) {
            return null;
        }

        if (bytes.length == 0 || (!startsWith(bytes, PNG_SIGNATURE)
                && !startsWith(bytes, JPEG_SIGNATURE))) {
            return null;
        }

        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(bytes);
            return hash.equals(toHex(digest)) ? bytes : null;
        } catch (NoSuchAlgorithmException error) {
            return null;
        }
    }

    private static boolean isHash(String hash) {
        if (hash == null || hash.length() != 64) {
            return false;
        }
        for (int index = 0; index < hash.length(); index++) {
            char character = hash.charAt(index);
            if (!((character >= '0' && character <= '9')
                    || (character >= 'a' && character <= 'f'))) {
                return false;
            }
        }
        return true;
    }

    private static boolean startsWith(byte[] bytes, byte[] signature) {
        if (bytes.length < signature.length) {
            return false;
        }
        for (int index = 0; index < signature.length; index++) {
            if (bytes[index] != signature[index]) {
                return false;
            }
        }
        return true;
    }

    private static String toHex(byte[] bytes) {
        char[] characters = new char[bytes.length * 2];
        for (int index = 0; index < bytes.length; index++) {
            int value = bytes[index] & 0xff;
            characters[index * 2] = HEX[value >>> 4];
            characters[index * 2 + 1] = HEX[value & 0x0f];
        }
        return new String(characters);
    }
}
