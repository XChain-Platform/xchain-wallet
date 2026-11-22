import io.xchain.wallet.android.wear.data.SnapshotFile;

import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;

public final class SnapshotFileCheck {
    private SnapshotFileCheck() {
    }

    public static void main(String[] args) {
        Path directory = freshDirectoryPath();
        SnapshotFile snapshotFile = new SnapshotFile(directory.toFile());

        require(snapshotFile.load() == null, "load before any save is null");

        byte[] first = new byte[] {1, 2, 3};
        save(snapshotFile, first, "save creates the directory");
        require(Files.isDirectory(directory), "save creates the directory");
        require(Arrays.equals(first, snapshotFile.load()), "load returns the saved bytes");

        byte[] second = new byte[] {9, 8, 7, 6};
        save(snapshotFile, second, "a second save overwrites");
        require(Arrays.equals(second, snapshotFile.load()), "a second save overwrites");

        File[] files = directory.toFile().listFiles();
        require(
                files != null
                        && files.length == 1
                        && SnapshotFile.FILE_NAME.equals(files[0].getName()),
                "after two saves only snapshot.json remains");

        require(snapshotFile.wipe(), "wipe on a present file returns true");
        require(snapshotFile.load() == null, "load after wipe is null");
        require(snapshotFile.wipe(), "wipe on an absent file returns true");

        directory.toFile().delete();
    }

    private static Path freshDirectoryPath() {
        File temporaryRoot = new File(System.getProperty("java.io.tmpdir"));
        long suffix = System.nanoTime();
        Path candidate;
        do {
            candidate = new File(temporaryRoot, "snapshot-file-check-" + suffix++).toPath();
        } while (Files.exists(candidate));
        return candidate;
    }

    private static void require(boolean condition, String caseName) {
        if (!condition) {
            fail(caseName);
        }
    }

    private static void save(SnapshotFile snapshotFile, byte[] data, String caseName) {
        try {
            snapshotFile.save(data);
        } catch (IOException ignored) {
            fail(caseName);
        }
    }

    private static void fail(String caseName) {
        System.err.println("FAIL: " + caseName);
        System.exit(1);
    }
}
