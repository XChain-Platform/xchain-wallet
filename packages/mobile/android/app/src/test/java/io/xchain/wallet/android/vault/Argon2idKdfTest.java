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

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.junit.runners.Parameterized;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Collection;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Runs every golden vector through {@link Argon2idKdf}, the class the plugin
 * calls. The vectors come from the JavaScript implementation existing wallets
 * were encrypted with, so a mismatch here means wallets that will not open.
 */
@RunWith(Parameterized.class)
public class Argon2idKdfTest {

    private static final String FIXTURE = "test/fixtures/crypto/argon2id-vectors.json";

    @Parameterized.Parameters(name = "{0}")
    public static Collection<Object[]> vectors() throws IOException {
        String json = new String(Files.readAllBytes(findFixture().toPath()), StandardCharsets.UTF_8);
        List<Object[]> cases = new ArrayList<>();
        // Each vector is a flat object; split on the objects inside the "vectors" array.
        Matcher object = Pattern.compile("\\{([^{}]*)\\}").matcher(json.substring(json.indexOf("\"vectors\"")));
        while (object.find()) {
            String body = object.group(1);
            cases.add(new Object[] {
                    text(body, "name"),
                    text(body, "password"),
                    text(body, "salt"),
                    number(body, "iterations"),
                    number(body, "memoryKib"),
                    number(body, "parallelism"),
                    number(body, "length"),
                    text(body, "keyHex"),
            });
        }
        assertEquals("the fixture holds five vectors", 5, cases.size());
        return cases;
    }

    private final String password;
    private final String salt;
    private final int iterations;
    private final int memoryKib;
    private final int parallelism;
    private final int length;
    private final String keyHex;

    public Argon2idKdfTest(String name, String password, String salt, int iterations, int memoryKib,
            int parallelism, int length, String keyHex) {
        this.password = password;
        this.salt = salt;
        this.iterations = iterations;
        this.memoryKib = memoryKib;
        this.parallelism = parallelism;
        this.length = length;
        this.keyHex = keyHex;
    }

    @Test
    public void derivesTheGoldenKey() {
        byte[] key = Argon2idKdf.derive(
                Argon2idKdf.utf8(password), Base64.getDecoder().decode(salt),
                iterations, memoryKib, parallelism, length);
        assertEquals(keyHex, hex(key));
    }

    @Test
    public void encodesThePasswordLikeTextEncoder() {
        assertArrayEquals(password.getBytes(StandardCharsets.UTF_8), Argon2idKdf.utf8(password));
    }

    // The two checks below do not depend on the vector; they repeat per vector because they are cheap.
    @Test
    public void refusesEveryBoundInTheContract() {
        assertNull(Argon2idKdf.checkBounds(3, 65536, 1, 32, 16));
        assertNotNull(Argon2idKdf.checkBounds(0, 65536, 1, 32, 16));
        assertNotNull(Argon2idKdf.checkBounds(65, 65536, 1, 32, 16));
        assertNotNull(Argon2idKdf.checkBounds(3, 65536, 0, 32, 16));
        assertNotNull(Argon2idKdf.checkBounds(3, 65536, 9, 32, 16));
        assertNotNull(Argon2idKdf.checkBounds(3, 15, 2, 32, 16));
        assertNull(Argon2idKdf.checkBounds(3, 16, 2, 32, 16));
        assertNotNull(Argon2idKdf.checkBounds(3, 1048577, 1, 32, 16));
        assertNotNull(Argon2idKdf.checkBounds(3, 65536, 1, 3, 16));
        assertNotNull(Argon2idKdf.checkBounds(3, 65536, 1, 65, 16));
        assertNotNull(Argon2idKdf.checkBounds(3, 65536, 1, 32, 7));
        assertNull(Argon2idKdf.checkBounds(3, 65536, 1, 32, 8));
    }

    @Test
    public void replacesALoneSurrogateAsTextEncoderDoes() {
        // new TextEncoder().encode("a\uD800b") is 61 EF BF BD 62.
        assertEquals("61efbfbd62", hex(Argon2idKdf.utf8("a\uD800b")));
        assertTrue(Argon2idKdf.utf8("").length == 0);
    }

    private static File findFixture() {
        File dir = new File(System.getProperty("user.dir")).getAbsoluteFile();
        // Gradle runs unit tests from the app module; walk up to the repository root.
        while (dir != null) {
            File candidate = new File(dir, FIXTURE);
            if (candidate.isFile()) return candidate;
            dir = dir.getParentFile();
        }
        throw new IllegalStateException(FIXTURE + " not found above " + System.getProperty("user.dir"));
    }

    private static String text(String body, String field) {
        Matcher m = Pattern.compile("\"" + field + "\"\\s*:\\s*\"((?:[^\"\\\\]|\\\\.)*)\"").matcher(body);
        if (!m.find()) throw new IllegalStateException("vector has no " + field);
        String raw = m.group(1);
        // The fixture uses no escapes; fail loudly rather than mis-decode one.
        if (raw.indexOf('\\') >= 0) throw new IllegalStateException(field + " uses a JSON escape");
        return raw;
    }

    private static int number(String body, String field) {
        Matcher m = Pattern.compile("\"" + field + "\"\\s*:\\s*(\\d+)").matcher(body);
        if (!m.find()) throw new IllegalStateException("vector has no " + field);
        return Integer.parseInt(m.group(1));
    }

    private static String hex(byte[] bytes) {
        StringBuilder sb = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) sb.append(String.format("%02x", b & 0xff));
        return sb.toString();
    }
}
