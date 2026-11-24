package io.xchain.wallet.android.watch;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.zip.CRC32;
import java.util.zip.Deflater;

public final class WatchRisk8Payload {

    private static final byte[] PNG_SIGNATURE = {
            (byte) 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a
    };
    private static final char[] HEX = "0123456789abcdef".toCharArray();

    private WatchRisk8Payload() {}

    public static byte[] snapshotJson(long builtAt) {
        StringBuilder json = new StringBuilder(32_768);
        json.append("{\"balancesAt\":").append(builtAt)
                .append(",\"builtAt\":").append(builtAt)
                .append(",\"capped\":false")
                .append(",\"fiatCode\":\"USD\"")
                .append(",\"hidden\":false")
                .append(",\"inbox\":[");

        for (int entry = 1; entry <= 20; entry++) {
            if (entry > 1) json.append(',');
            String number = twoDigits(entry);
            json.append("{\"at\":").append(builtAt - entry * 60_000L)
                    .append(",\"body\":\"")
                    .append(padded("Risk eight alert " + number, 160))
                    .append("\",\"family\":\"incomingReceipts\"")
                    .append(",\"id\":\"alert-").append(number)
                    .append("\",\"kind\":\"incoming\"")
                    .append(",\"read\":false")
                    .append(",\"title\":\"")
                    .append(padded("Received R" + number, 60))
                    .append("\"}");
        }

        json.append("],\"network\":{\"isTest\":false,\"kind\":\"mainnet\"}")
                .append(",\"pricesAt\":").append(builtAt)
                .append(",\"receive\":[]")
                .append(",\"request\":{")
                .append("\"amountText\":\"0.50 BTC\"")
                .append(",\"iconHash\":\"\"")
                .append(",\"id\":\"0123456789abcdef0123456789abcdef\"")
                .append(",\"kind\":\"request\"")
                .append(",\"sentence\":\"Review this request on your phone\"}")
                .append(",\"rows\":[");

        for (int row = 1; row <= 50; row++) {
            if (row > 1) json.append(',');
            String number = twoDigits(row);
            String tick = "R" + number;
            json.append("{\"amountText\":\"").append(row).append(' ').append(tick)
                    .append("\",\"chainId\":\"bitcoin-mainnet\"")
                    .append(",\"displayName\":\"")
                    .append(padded("Risk eight token " + tick, 64))
                    .append("\",\"fiatText\":\"$").append(row).append(".00\"")
                    .append(",\"hasDetail\":false")
                    .append(",\"iconHash\":\"\"")
                    .append(",\"id\":\"bitcoin-mainnet:").append(tick)
                    .append("\",\"noPrice\":false")
                    .append(",\"pendingText\":\"\"")
                    .append(",\"tick\":\"").append(tick)
                    .append("\",\"tickerColor\":\"#3B82F6\"")
                    .append(",\"unavailable\":false}");
        }

        json.append("],\"session\":\"unlocked\"")
                .append(",\"settings\":{\"enabled\":true,\"showTotal\":true}")
                .append(",\"totals\":{\"fiatText\":\"$1,275.00\",\"unitsText\":\"Balances\"}")
                .append(",\"unitDefault\":\"fiat\"")
                .append(",\"v\":1")
                .append(",\"walletName\":\"Risk eight wallet\"}");
        return json.toString().getBytes(StandardCharsets.UTF_8);
    }

    public static byte[] png(int side) {
        if (side < 1 || side > 1024) return null;

        int scanlineLength = side * 3 + 1;
        byte[] pixels = new byte[side * scanlineLength];
        for (int y = 0; y < side; y++) {
            int offset = y * scanlineLength + 1;
            for (int x = 0; x < side; x++) {
                pixels[offset++] = (byte) (x & 0xff);
                pixels[offset++] = (byte) (y & 0xff);
                pixels[offset++] = (byte) 128;
            }
        }

        byte[] compressed = deflate(pixels);
        ByteArrayOutputStream png = new ByteArrayOutputStream(compressed.length + 57);
        png.write(PNG_SIGNATURE, 0, PNG_SIGNATURE.length);

        byte[] header = new byte[13];
        writeInt(header, 0, side);
        writeInt(header, 4, side);
        header[8] = 8;
        header[9] = 2;
        writeChunk(png, "IHDR", header);
        writeChunk(png, "IDAT", compressed);
        writeChunk(png, "IEND", new byte[0]);
        return png.toByteArray();
    }

    public static String sha256Hex(byte[] bytes) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(bytes);
            char[] result = new char[digest.length * 2];
            for (int index = 0; index < digest.length; index++) {
                int value = digest[index] & 0xff;
                result[index * 2] = HEX[value >>> 4];
                result[index * 2 + 1] = HEX[value & 0x0f];
            }
            return new String(result);
        } catch (NoSuchAlgorithmException error) {
            throw new IllegalStateException(error);
        }
    }

    private static byte[] deflate(byte[] input) {
        Deflater deflater = new Deflater();
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        try {
            deflater.setInput(input);
            deflater.finish();
            while (!deflater.finished()) {
                int count = deflater.deflate(buffer);
                output.write(buffer, 0, count);
            }
            return output.toByteArray();
        } finally {
            deflater.end();
        }
    }

    private static void writeChunk(ByteArrayOutputStream output, String name, byte[] data) {
        byte[] type = name.getBytes(StandardCharsets.US_ASCII);
        writeInt(output, data.length);
        output.write(type, 0, type.length);
        output.write(data, 0, data.length);

        CRC32 crc = new CRC32();
        crc.update(type, 0, type.length);
        crc.update(data, 0, data.length);
        writeInt(output, (int) crc.getValue());
    }

    private static void writeInt(ByteArrayOutputStream output, int value) {
        output.write((value >>> 24) & 0xff);
        output.write((value >>> 16) & 0xff);
        output.write((value >>> 8) & 0xff);
        output.write(value & 0xff);
    }

    private static void writeInt(byte[] output, int offset, int value) {
        output[offset] = (byte) (value >>> 24);
        output[offset + 1] = (byte) (value >>> 16);
        output[offset + 2] = (byte) (value >>> 8);
        output[offset + 3] = (byte) value;
    }

    private static String padded(String value, int length) {
        StringBuilder result = new StringBuilder(length);
        result.append(value);
        while (result.length() < length) result.append('.');
        return result.toString();
    }

    private static String twoDigits(int value) {
        return value < 10 ? "0" + value : Integer.toString(value);
    }
}
