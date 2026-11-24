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

import io.xchain.wallet.android.watch.WatchImagePayload;

import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Arrays;
import java.util.Base64;

public final class WatchImagePayloadCheck {

    private static final char[] HEX = "0123456789abcdef".toCharArray();

    private WatchImagePayloadCheck() {}

    public static void main(String[] args) {
        byte[] png = {
                (byte) 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
                0x00, 0x01, 0x02
        };
        byte[] jpeg = {
                (byte) 0xff, (byte) 0xd8, (byte) 0xff, (byte) 0xe0,
                0x00, 0x10, 0x4a, 0x46, 0x49, 0x46
        };
        byte[] gif = {0x47, 0x49, 0x46, 0x38, 0x39, 0x61};

        String pngHash = sha256(png);
        String pngBase64 = Base64.getEncoder().encodeToString(png);

        expectBytes("PNG signature", WatchImagePayload.decode(pngHash, pngBase64), png);
        expectBytes("JPEG signature", WatchImagePayload.decode(
                sha256(jpeg), Base64.getEncoder().encodeToString(jpeg)), jpeg);
        expectNull("upper-case hash", WatchImagePayload.decode(
                pngHash.toUpperCase(), pngBase64));
        expectNull("63-character hash", WatchImagePayload.decode(
                pngHash.substring(1), pngBase64));
        expectNull("hash of other bytes", WatchImagePayload.decode(sha256(gif), pngBase64));
        expectNull("null hash", WatchImagePayload.decode(null, pngBase64));
        expectNull("null base64", WatchImagePayload.decode(pngHash, null));
        expectNull("invalid base64", WatchImagePayload.decode(pngHash, "not base64"));
        expectNull("empty base64", WatchImagePayload.decode(pngHash, ""));
        expectNull("GIF89a signature", WatchImagePayload.decode(
                sha256(gif), Base64.getEncoder().encodeToString(gif)));

        System.out.println("WatchImagePayloadCheck ok");
    }

    private static String sha256(byte[] bytes) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(bytes);
            char[] characters = new char[digest.length * 2];
            for (int index = 0; index < digest.length; index++) {
                int value = digest[index] & 0xff;
                characters[index * 2] = HEX[value >>> 4];
                characters[index * 2 + 1] = HEX[value & 0x0f];
            }
            return new String(characters);
        } catch (NoSuchAlgorithmException error) {
            throw new AssertionError(error);
        }
    }

    private static void expectBytes(String name, byte[] actual, byte[] expected) {
        if (!Arrays.equals(actual, expected)) {
            fail(name);
        }
    }

    private static void expectNull(String name, byte[] actual) {
        if (actual != null) {
            fail(name);
        }
    }

    private static void fail(String name) {
        System.err.println("FAILED: " + name);
        System.exit(1);
    }
}
