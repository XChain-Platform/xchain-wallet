import io.xchain.wallet.android.watch.WatchImagePayload;
import io.xchain.wallet.android.watch.WatchRisk8Payload;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Arrays;
import java.util.Base64;
import java.util.zip.CRC32;
import java.util.zip.DataFormatException;
import java.util.zip.Inflater;

public final class WatchRisk8PayloadCheck {

    private static final byte[] PNG_SIGNATURE = {
            (byte) 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a
    };

    private WatchRisk8PayloadCheck() {}

    public static void main(String[] arguments) throws Exception {
        check(arguments.length == 1, "output path argument");

        byte[] snapshot = WatchRisk8Payload.snapshotJson(1_700_000_000_000L);
        check(snapshot.length >= 16_384, "snapshot minimum size");
        check(snapshot.length <= 61_440, "snapshot budget");
        passed("snapshot size");

        String text = new String(snapshot, StandardCharsets.UTF_8);
        check(text.startsWith("{\"balancesAt\":1700000000000,"), "snapshot prefix");
        passed("snapshot prefix");
        check(count(text, "\"displayName\":\"") == 50, "snapshot row count");
        passed("50 displayName fields");
        check(count(text, "\"family\":\"incomingReceipts\"") == 20, "snapshot inbox count");
        passed("20 family fields");
        check(Arrays.equals(snapshot, WatchRisk8Payload.snapshotJson(1_700_000_000_000L)),
                "snapshot determinism");
        passed("snapshot determinism");

        Path output = Paths.get(arguments[0]);
        Files.write(output, snapshot);

        byte[] png = WatchRisk8Payload.png(400);
        check(png != null, "png is present");
        check(startsWith(png, PNG_SIGNATURE), "png signature");
        check(readInt(png, 16) == 400, "png width");
        check(readInt(png, 20) == 400, "png height");
        check(png[24] == 8 && png[25] == 2 && png[28] == 0, "png format");
        passed("png(400) header");

        byte[] inflated = inflateIdat(png);
        check(inflated.length == 400 * 1201, "png inflated size");
        checkPixel(inflated, 400, 0, 0);
        checkPixel(inflated, 400, 255, 255);
        checkPixel(inflated, 400, 399, 399);
        passed("png inflate length and pixels");

        String base64 = Base64.getEncoder().encodeToString(png);
        byte[] decoded = WatchImagePayload.decode(WatchRisk8Payload.sha256Hex(png), base64);
        check(Arrays.equals(decoded, png), "image payload decode");
        passed("decode round trip");
        check(Arrays.equals(png, WatchRisk8Payload.png(400)), "png determinism");
        passed("png determinism");
        check(WatchRisk8Payload.png(0) == null, "png zero boundary");
        passed("png(0) null");
        check(WatchRisk8Payload.png(1025) == null, "png upper boundary");
        passed("png(1025) null");
    }

    private static byte[] inflateIdat(byte[] png) throws DataFormatException {
        ByteArrayOutputStream compressed = new ByteArrayOutputStream();
        int chunks = 0;
        int offset = PNG_SIGNATURE.length;
        while (offset + 12 <= png.length) {
            int length = readInt(png, offset);
            check(length >= 0 && offset + 12 + length <= png.length, "png chunk bounds");
            String type = new String(png, offset + 4, 4, StandardCharsets.US_ASCII);
            CRC32 crc = new CRC32();
            crc.update(png, offset + 4, length + 4);
            check(crc.getValue() == (readInt(png, offset + 8 + length) & 0xffffffffL),
                    "png chunk CRC");
            if ("IDAT".equals(type)) {
                compressed.write(png, offset + 8, length);
                chunks++;
            }
            offset += length + 12;
        }
        check(offset == png.length, "png chunk framing");
        check(chunks == 1, "single IDAT chunk");

        Inflater inflater = new Inflater();
        ByteArrayOutputStream output = new ByteArrayOutputStream(400 * 1201);
        byte[] buffer = new byte[8192];
        try {
            inflater.setInput(compressed.toByteArray());
            while (!inflater.finished()) {
                int count = inflater.inflate(buffer);
                check(count > 0, "png IDAT progress");
                output.write(buffer, 0, count);
            }
            check(inflater.getRemaining() == 0, "png IDAT consumed");
            return output.toByteArray();
        } finally {
            inflater.end();
        }
    }

    private static void checkPixel(byte[] pixels, int side, int x, int y) {
        int scanline = side * 3 + 1;
        int offset = y * scanline;
        check(pixels[offset] == 0, "png row filter");
        offset += 1 + x * 3;
        check((pixels[offset] & 0xff) == x % 256, "png red channel");
        check((pixels[offset + 1] & 0xff) == y % 256, "png green channel");
        check((pixels[offset + 2] & 0xff) == 128, "png blue channel");
    }

    private static int count(String text, String needle) {
        int count = 0;
        int offset = 0;
        while ((offset = text.indexOf(needle, offset)) >= 0) {
            count++;
            offset += needle.length();
        }
        return count;
    }

    private static boolean startsWith(byte[] bytes, byte[] prefix) {
        if (bytes.length < prefix.length) return false;
        for (int index = 0; index < prefix.length; index++) {
            if (bytes[index] != prefix[index]) return false;
        }
        return true;
    }

    private static int readInt(byte[] bytes, int offset) {
        return (bytes[offset] & 0xff) << 24
                | (bytes[offset + 1] & 0xff) << 16
                | (bytes[offset + 2] & 0xff) << 8
                | bytes[offset + 3] & 0xff;
    }

    private static void passed(String name) {
        System.out.println("ok " + name);
    }

    private static void check(boolean condition, String name) {
        if (!condition) {
            System.err.println("WatchRisk8PayloadCheck failed: " + name);
            System.exit(1);
        }
    }
}
