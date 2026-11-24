package io.xchain.wallet.android.wear.nav;

import java.nio.ByteBuffer;
import java.nio.CharBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;

public final class WatchNavRoutes {
    public static final String TOKEN_ID_ARG = "tokenId";
    public static final String ALERT_ID_ARG = "alertId";

    private static final char[] HEX = "0123456789ABCDEF".toCharArray();

    private WatchNavRoutes() {}

    public static String pattern(WatchScreenGraph.Screen screen) {
        switch (screen) {
            case TOKEN_DETAIL:
                return screen.route() + "/{" + TOKEN_ID_ARG + "}";
            case ALERT_DETAIL:
                return screen.route() + "/{" + ALERT_ID_ARG + "}";
            default:
                return screen.route();
        }
    }

    public static String tokenDetail(String tokenId) {
        return detailRoute(WatchScreenGraph.Screen.TOKEN_DETAIL, tokenId);
    }

    public static String alertDetail(String alertId) {
        return detailRoute(WatchScreenGraph.Screen.ALERT_DETAIL, alertId);
    }

    public static String encode(String value) {
        if (value == null) {
            throw new NullPointerException("value");
        }

        ByteBuffer bytes;
        try {
            bytes = StandardCharsets.UTF_8.newEncoder()
                    .onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT)
                    .encode(CharBuffer.wrap(value));
        } catch (CharacterCodingException failure) {
            throw new IllegalArgumentException("value is not valid UTF-16", failure);
        }

        StringBuilder encoded = new StringBuilder(bytes.remaining());
        while (bytes.hasRemaining()) {
            int current = bytes.get() & 0xff;
            if (isUnreserved(current)) {
                encoded.append((char) current);
            } else {
                encoded.append('%');
                encoded.append(HEX[current >>> 4]);
                encoded.append(HEX[current & 0x0f]);
            }
        }
        return encoded.toString();
    }

    public static String decode(String value) {
        if (value == null) {
            throw new NullPointerException("value");
        }

        ByteBuffer bytes = ByteBuffer.allocate(Math.max(1, value.length() * 3));
        int index = 0;
        while (index < value.length()) {
            if (value.charAt(index) == '%') {
                if (index + 2 >= value.length()) {
                    return null;
                }
                int high = hexValue(value.charAt(index + 1));
                int low = hexValue(value.charAt(index + 2));
                if (high < 0 || low < 0) {
                    return null;
                }
                bytes.put((byte) ((high << 4) | low));
                index += 3;
                continue;
            }

            int nextPercent = value.indexOf('%', index);
            int end = nextPercent < 0 ? value.length() : nextPercent;
            try {
                ByteBuffer literal = StandardCharsets.UTF_8.newEncoder()
                        .onMalformedInput(CodingErrorAction.REPORT)
                        .onUnmappableCharacter(CodingErrorAction.REPORT)
                        .encode(CharBuffer.wrap(value, index, end));
                bytes.put(literal);
            } catch (CharacterCodingException failure) {
                return null;
            }
            index = end;
        }

        bytes.flip();
        try {
            return StandardCharsets.UTF_8.newDecoder()
                    .onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT)
                    .decode(bytes)
                    .toString();
        } catch (CharacterCodingException failure) {
            return null;
        }
    }

    public static String argument(String route, WatchScreenGraph.Screen screen) {
        String prefix = screen.route() + "/";
        if (route == null || !route.startsWith(prefix)) {
            return null;
        }

        String encoded = route.substring(prefix.length());
        if (encoded.isEmpty() || encoded.indexOf('/') >= 0) {
            return null;
        }
        return decode(encoded);
    }

    private static String detailRoute(WatchScreenGraph.Screen screen, String id) {
        if (id == null || id.isEmpty()) {
            throw new IllegalArgumentException("id must not be null or empty");
        }
        return screen.route() + "/" + encode(id);
    }

    private static boolean isUnreserved(int value) {
        return value >= 'A' && value <= 'Z'
                || value >= 'a' && value <= 'z'
                || value >= '0' && value <= '9'
                || value == '-'
                || value == '.'
                || value == '_'
                || value == '~';
    }

    private static int hexValue(char value) {
        if (value >= '0' && value <= '9') {
            return value - '0';
        }
        if (value >= 'A' && value <= 'F') {
            return value - 'A' + 10;
        }
        if (value >= 'a' && value <= 'f') {
            return value - 'a' + 10;
        }
        return -1;
    }
}
