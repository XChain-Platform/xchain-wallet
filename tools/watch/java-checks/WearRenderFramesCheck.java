import io.xchain.wallet.android.wear.render.WearRenderFrames;
import io.xchain.wallet.android.wear.render.WearRenderFrames.Size;

import java.nio.file.Path;

public final class WearRenderFramesCheck {
    private WearRenderFramesCheck() {
    }

    public static void main(String[] args) {
        checkSize(Size.SMALL_ROUND, 192, 384, "small-round",
                "w192dp-h192dp-round-watch-xhdpi");
        checkSize(Size.LARGE_ROUND, 227, 454, "large-round",
                "w227dp-h227dp-round-watch-xhdpi");

        check(Size.SMALL_ROUND.pixelSide() >= 384, "small round screenshot minimum");
        check(Size.LARGE_ROUND.pixelSide() >= 384, "large round screenshot minimum");

        check("w1-snapshot-rows50-small-round.png".equals(WearRenderFrames.frameName(
                "w1", "snapshot-rows50.json", Size.SMALL_ROUND)),
                "small round frame name");
        check("w2-detail-native-large-round.png".equals(WearRenderFrames.frameName(
                "w2", "detail-native.json", Size.LARGE_ROUND)),
                "large round frame name");
        check("snapshot-empty".equals(WearRenderFrames.fixtureStem("snapshot-empty")),
                "fixture stem without suffix");

        checkInvalidFixture("Snapshot.json");
        checkInvalidFixture("snapshot_rows.json");
        checkInvalidFixture(".json");
        checkInvalidFixture("");
        checkInvalidFixture("../x.json");
        checkInvalidFixture("a--b.json");

        checkInvalidScreen("W1");
        checkInvalidScreen("1w");
        checkInvalidScreen("");
        checkInvalidScreen("w1/x");

        check(WearRenderFrames.outDir(null) == null, "null output directory");
        check(WearRenderFrames.outDir("") == null, "empty output directory");
        check(WearRenderFrames.outDir("  ") == null, "blank output directory");
        check(Path.of("/tmp/frames").equals(WearRenderFrames.outDir(" /tmp/frames ")),
                "trimmed output directory");

        System.out.println("WearRenderFramesCheck: PASS");
    }

    private static void checkSize(Size size, int dp, int pixelSide, String slug,
            String qualifiers) {
        check(size.dp() == dp, size + " dp");
        check(size.densityDpi() == 320, size + " density");
        check(size.pixelSide() == pixelSide, size + " pixel side");
        check(size.slug().equals(slug), size + " slug");
        check(size.qualifiers().equals(qualifiers), size + " qualifiers");
    }

    private static void checkInvalidFixture(String fileName) {
        try {
            WearRenderFrames.fixtureStem(fileName);
            fail("fixture accepted: " + fileName);
        } catch (IllegalArgumentException expected) {
        }
    }

    private static void checkInvalidScreen(String screen) {
        try {
            WearRenderFrames.frameName(screen, "snapshot-empty.json", Size.SMALL_ROUND);
            fail("screen accepted: " + screen);
        } catch (IllegalArgumentException expected) {
        }
    }

    private static void check(boolean condition, String caseName) {
        if (!condition) {
            fail(caseName);
        }
    }

    private static void fail(String caseName) {
        System.err.println("WearRenderFramesCheck: FAIL: " + caseName);
        System.exit(1);
    }
}
