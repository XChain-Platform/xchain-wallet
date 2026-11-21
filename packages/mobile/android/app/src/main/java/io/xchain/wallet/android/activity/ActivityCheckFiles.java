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

import java.io.BufferedWriter;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStreamWriter;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;

final class ActivityCheckFiles {

    static final String CONFIG_FILE = "activity-check.json";
    static final String RUNS_FILE = "activity-check-runs.txt";

    private static final int MAX_RUNS = 20;

    private final File directory;

    ActivityCheckFiles(File directory) {
        this.directory = directory;
    }

    void writeConfig(String json) throws IOException {
        writeAtomically(configFile(), json);
    }

    String readConfig() throws IOException {
        File config = configFile();
        if (!config.isFile()) return null;
        return new String(Files.readAllBytes(config.toPath()), StandardCharsets.UTF_8);
    }

    void appendRun(long atMs) throws IOException {
        java.util.List<Long> runs = runLog();
        runs.add(atMs);
        int first = Math.max(0, runs.size() - MAX_RUNS);
        StringBuilder text = new StringBuilder();
        for (int i = first; i < runs.size(); i++) {
            text.append(runs.get(i)).append('\n');
        }
        writeAtomically(runsFile(), text.toString());
    }

    java.util.List<Long> runLog() throws IOException {
        java.util.List<Long> runs = new java.util.ArrayList<>();
        File file = runsFile();
        if (!file.isFile()) return runs;
        for (String line : Files.readAllLines(file.toPath(), StandardCharsets.UTF_8)) {
            try {
                runs.add(Long.parseLong(line.trim()));
            } catch (NumberFormatException ignored) {
            }
        }
        return runs;
    }

    boolean clear() {
        File config = configFile();
        File runs = runsFile();
        if (config.exists()) config.delete();
        if (runs.exists()) runs.delete();
        return !config.exists() && !runs.exists();
    }

    private File configFile() {
        return new File(directory, CONFIG_FILE);
    }

    private File runsFile() {
        return new File(directory, RUNS_FILE);
    }

    private void writeAtomically(File target, String text) throws IOException {
        if (!directory.isDirectory() && !directory.mkdirs() && !directory.isDirectory()) {
            throw new IOException("could not create " + directory);
        }
        File temporary = new File(directory, target.getName() + ".tmp");
        try {
            try (FileOutputStream bytes = new FileOutputStream(temporary);
                    BufferedWriter writer = new BufferedWriter(
                            new OutputStreamWriter(bytes, StandardCharsets.UTF_8))) {
                writer.write(text);
                writer.flush();
                bytes.getFD().sync();
            }
            try {
                Files.move(temporary.toPath(), target.toPath(),
                        StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
            } catch (AtomicMoveNotSupportedException e) {
                Files.move(temporary.toPath(), target.toPath(), StandardCopyOption.REPLACE_EXISTING);
            }
        } finally {
            if (temporary.exists()) temporary.delete();
        }
    }
}
