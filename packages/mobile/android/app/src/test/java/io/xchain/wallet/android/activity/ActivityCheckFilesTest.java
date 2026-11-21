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
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Before;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.List;

public class ActivityCheckFilesTest {

    @Rule
    public final TemporaryFolder temporaryFolder = new TemporaryFolder();

    private File directory;
    private ActivityCheckFiles files;

    @Before
    public void setUp() throws Exception {
        directory = temporaryFolder.newFolder("activity-check");
        files = new ActivityCheckFiles(directory);
    }

    @Test
    public void writesAndReadsConfig() throws Exception {
        files.writeConfig("{\"enabled\":true}");

        assertEquals("{\"enabled\":true}", files.readConfig());
    }

    @Test
    public void overwritesConfig() throws Exception {
        files.writeConfig("first");
        files.writeConfig("second");

        assertEquals("second", files.readConfig());
    }

    @Test
    public void absentConfigIsNull() throws Exception {
        assertNull(files.readConfig());
    }

    @Test
    public void keepsTheLastTwentyRunsInOrder() throws Exception {
        for (long atMs = 1; atMs <= 25; atMs++) files.appendRun(atMs);

        List<Long> expected = new ArrayList<>();
        for (long atMs = 6; atMs <= 25; atMs++) expected.add(atMs);
        assertEquals(expected, files.runLog());
    }

    @Test
    public void skipsAnUnparseableRunLine() throws Exception {
        Files.write(new File(directory, ActivityCheckFiles.RUNS_FILE).toPath(),
                "10\njunk\n20\n".getBytes(StandardCharsets.UTF_8));

        assertEquals(java.util.Arrays.asList(10L, 20L), files.runLog());
    }

    @Test
    public void clearsPresentFiles() throws Exception {
        files.writeConfig("config");
        files.appendRun(100L);

        assertTrue(files.clear());
        assertFalse(new File(directory, ActivityCheckFiles.CONFIG_FILE).exists());
        assertFalse(new File(directory, ActivityCheckFiles.RUNS_FILE).exists());
    }

    @Test
    public void clearsAbsentFiles() {
        assertTrue(files.clear());
    }

    @Test
    public void leavesNoTemporaryFilesAfterWrites() throws Exception {
        files.writeConfig("first");
        files.writeConfig("second");
        files.appendRun(1L);

        assertFalse(new File(directory, ActivityCheckFiles.CONFIG_FILE + ".tmp").exists());
        assertFalse(new File(directory, ActivityCheckFiles.RUNS_FILE + ".tmp").exists());
    }
}
