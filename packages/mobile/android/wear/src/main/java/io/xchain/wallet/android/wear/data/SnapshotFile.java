package io.xchain.wallet.android.wear.data;

import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;

public final class SnapshotFile {
    public static final String FILE_NAME = "snapshot.json";

    private final Path directory;
    private final Path snapshot;

    public SnapshotFile(File directory) {
        this.directory = directory.toPath();
        this.snapshot = this.directory.resolve(FILE_NAME);
    }

    public void save(byte[] data) throws IOException {
        Files.createDirectories(directory);
        Path temporary = Files.createTempFile(directory, FILE_NAME, ".tmp");
        try {
            Files.write(temporary, data);
            Files.move(
                    temporary,
                    snapshot,
                    StandardCopyOption.ATOMIC_MOVE,
                    StandardCopyOption.REPLACE_EXISTING);
        } finally {
            Files.deleteIfExists(temporary);
        }
    }

    public byte[] load() {
        try {
            return Files.readAllBytes(snapshot);
        } catch (IOException | SecurityException ignored) {
            return null;
        }
    }

    public boolean wipe() {
        try {
            Files.deleteIfExists(snapshot);
            return !Files.exists(snapshot);
        } catch (IOException | SecurityException ignored) {
            return false;
        }
    }
}
