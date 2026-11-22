package io.xchain.wallet.android.wear.render;

import java.nio.file.Path;

public final class WearRenderFrames {
    private WearRenderFrames() {
    }

    public enum Size {
        SMALL_ROUND(192, 384, "small-round", "w192dp-h192dp-round-watch-xhdpi"),
        LARGE_ROUND(227, 454, "large-round", "w227dp-h227dp-round-watch-xhdpi");

        private static final int DENSITY_DPI = 320;

        private final int dp;
        private final int pixelSide;
        private final String slug;
        private final String qualifiers;

        Size(int dp, int pixelSide, String slug, String qualifiers) {
            this.dp = dp;
            this.pixelSide = pixelSide;
            this.slug = slug;
            this.qualifiers = qualifiers;
        }

        public int dp() {
            return dp;
        }

        public int densityDpi() {
            return DENSITY_DPI;
        }

        public int pixelSide() {
            return pixelSide;
        }

        public String slug() {
            return slug;
        }

        public String qualifiers() {
            return qualifiers;
        }
    }

    public static String fixtureStem(String fileName) {
        if (fileName == null) {
            throw new IllegalArgumentException("fixture file name is required");
        }
        String stem = fileName.endsWith(".json")
                ? fileName.substring(0, fileName.length() - ".json".length())
                : fileName;
        if (!stem.matches("[a-z0-9]+(-[a-z0-9]+)*")) {
            throw new IllegalArgumentException("invalid fixture file name: " + fileName);
        }
        return stem;
    }

    public static String frameName(String screen, String fixtureFile, Size size) {
        if (screen == null || !screen.matches("[a-z][a-z0-9]*")) {
            throw new IllegalArgumentException("invalid screen: " + screen);
        }
        if (size == null) {
            throw new IllegalArgumentException("size is required");
        }
        return screen + "-" + fixtureStem(fixtureFile) + "-" + size.slug() + ".png";
    }

    public static Path outDir(String envValue) {
        if (envValue == null || envValue.trim().isEmpty()) {
            return null;
        }
        return Path.of(envValue.trim());
    }
}
