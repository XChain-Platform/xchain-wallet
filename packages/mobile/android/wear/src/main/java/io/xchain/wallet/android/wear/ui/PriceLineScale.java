package io.xchain.wallet.android.wear.ui;

public final class PriceLineScale {
    public enum Tone {
        GAIN,
        LOSS
    }

    private PriceLineScale() {
    }

    public static Tone tone(boolean up) {
        return up ? Tone.GAIN : Tone.LOSS;
    }

    public static double[] xDomain(int count) {
        if (count < 2) {
            return null;
        }

        return new double[] {0.0, count - 1.0};
    }

    public static double[] yDomain(double[] points) {
        if (points == null || points.length < 2) {
            return null;
        }

        double minimum = points[0];
        double maximum = points[0];
        for (double point : points) {
            if (!Double.isFinite(point)) {
                return null;
            }
            minimum = Math.min(minimum, point);
            maximum = Math.max(maximum, point);
        }

        if (minimum != maximum) {
            return new double[] {minimum, maximum};
        }

        double pad = minimum == 0.0 ? 1.0 : Math.abs(minimum) * 0.01;
        return new double[] {minimum - pad, maximum + pad};
    }
}
