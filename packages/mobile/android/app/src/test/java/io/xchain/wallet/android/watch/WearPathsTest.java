package io.xchain.wallet.android.watch;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class WearPathsTest {

    private static final String HASH =
            "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    @Test
    public void exposesWearDataLayerConstants() {
        assertEquals("/xc/", WearPaths.PREFIX);
        assertEquals("/xc/snapshot", WearPaths.SNAPSHOT);
        assertEquals("/xc/state", WearPaths.STATE);
        assertEquals(100000, WearPaths.CHANNEL_THRESHOLD_BYTES);
    }

    @Test
    public void buildsDetailPath() {
        assertEquals("/xc/detail/token-1", WearPaths.detailPath("token-1"));
    }

    @Test
    public void rejectsNullOrEmptyDetailId() {
        assertThrows(IllegalArgumentException.class, () -> WearPaths.detailPath(null));
        assertThrows(IllegalArgumentException.class, () -> WearPaths.detailPath(""));
    }

    @Test
    public void buildsImagePath() {
        assertEquals("/xc/image/" + HASH, WearPaths.imagePath(HASH));
    }

    @Test
    public void rejectsInvalidImageHash() {
        assertThrows(IllegalArgumentException.class, () -> WearPaths.imagePath(HASH.toUpperCase()));
        assertThrows(IllegalArgumentException.class, () -> WearPaths.imagePath(HASH.substring(1)));
        assertThrows(IllegalArgumentException.class, () -> WearPaths.imagePath(HASH.substring(0, 63) + "g"));
    }

    @Test
    public void usesChannelOnlyAboveThreshold() {
        assertFalse(WearPaths.useChannel(100000));
        assertTrue(WearPaths.useChannel(100001));
    }

    @Test
    public void permitsOnlyStateAsADataItemPath() {
        assertTrue(WearPaths.isDataItemPathAllowed("/xc/state"));
        assertFalse(WearPaths.isDataItemPathAllowed("/xc/snapshot"));
        assertFalse(WearPaths.isDataItemPathAllowed("/xc/state/x"));
    }

    @Test
    public void recognizesOnlyPrefixedWatchPaths() {
        assertTrue(WearPaths.isWatchPath("/xc/a"));
        assertFalse(WearPaths.isWatchPath("/xcx/a"));
        assertFalse(WearPaths.isWatchPath("xc/a"));
        assertFalse(WearPaths.isWatchPath(null));
    }
}
