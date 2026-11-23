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

package io.xchain.wallet.android.activity;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.json.JSONObject;
import org.junit.Before;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.concurrent.atomic.AtomicBoolean;

@RunWith(RobolectricTestRunner.class)
public class ActivityCheckStoreTest {

    @Rule
    public final TemporaryFolder temporaryFolder = new TemporaryFolder();

    private File appFiles;
    private AtomicBoolean cancelled;
    private ActivityCheckStore store;

    @Before
    public void setUp() throws Exception {
        appFiles = temporaryFolder.newFolder("app-files");
        cancelled = new AtomicBoolean();
        store = new ActivityCheckStore(appFiles, () -> cancelled.set(true));
    }

    @Test
    public void storesOnlyPublicConfigOutsideTheVault() throws Exception {
        File vault = new File(appFiles, "xchain-vault");
        assertTrue(vault.mkdir());
        String json = "{\"enabled\":true,\"privateKey\":\"top-secret\","
                + "\"targets\":[{\"address\":\"1Public\",\"url\":\"https://example.test/1Public\","
                + "\"confirmedPath\":\"balances.confirmed\",\"pendingPath\":\"balances.pending\","
                + "\"confirmed\":\"1\",\"pending\":\"0\",\"seedPhrase\":\"word word\"}],"
                + "\"notice\":{\"title\":\"New activity\",\"body\":\"Open wallet\","
                + "\"authToken\":\"notice-secret\"},\"openOnPhoneTitle\":\"Open on phone\"}";

        store.setActivityCheck(json);

        File config = new File(appFiles, ActivityCheckFiles.CONFIG_FILE);
        String stored = new String(Files.readAllBytes(config.toPath()), StandardCharsets.UTF_8);
        JSONObject storedConfig = new JSONObject(stored);
        JSONObject target = storedConfig.getJSONArray("targets").getJSONObject(0);
        assertEquals(4, storedConfig.length());
        assertEquals(6, target.length());
        assertEquals("1Public", target.getString("address"));
        assertEquals("https://example.test/1Public", target.getString("url"));
        assertEquals("balances.confirmed", target.getString("confirmedPath"));
        assertEquals("balances.pending", target.getString("pendingPath"));
        assertEquals("1", target.getString("confirmed"));
        assertEquals("0", target.getString("pending"));
        assertEquals(2, storedConfig.getJSONObject("notice").length());
        assertEquals("Open on phone", storedConfig.getString("openOnPhoneTitle"));
        assertFalse(stored.contains("top-secret"));
        assertFalse(stored.contains("word word"));
        assertFalse(stored.contains("notice-secret"));
        assertFalse(new File(vault, ActivityCheckFiles.CONFIG_FILE).exists());
    }

    @Test
    public void returnsTheRunLogOldestFirst() throws Exception {
        Files.write(new File(appFiles, ActivityCheckFiles.RUNS_FILE).toPath(),
                "10\n20\n30\n".getBytes(StandardCharsets.UTF_8));

        assertEquals(java.util.Arrays.asList(10L, 20L, 30L), store.runLog());
    }

    @Test
    public void clearDeletesFilesAndCancelsPeriodicWork() throws Exception {
        store.setActivityCheck("{\"enabled\":false,\"targets\":[],\"notice\":{\"title\":\"New activity\","
                + "\"body\":\"Open wallet\"},\"openOnPhoneTitle\":\"Open on phone\"}");
        Files.write(new File(appFiles, ActivityCheckFiles.RUNS_FILE).toPath(),
                "100\n".getBytes(StandardCharsets.UTF_8));

        assertTrue(store.clear());
        assertTrue(cancelled.get());
        assertFalse(new File(appFiles, ActivityCheckFiles.CONFIG_FILE).exists());
        assertFalse(new File(appFiles, ActivityCheckFiles.RUNS_FILE).exists());
    }

    @Test
    public void exposesThePeriodicWorkName() {
        assertEquals("xc_activity_check", ActivityCheckStore.WORK_NAME);
    }
}
