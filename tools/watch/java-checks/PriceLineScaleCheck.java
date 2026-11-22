import io.xchain.wallet.android.wear.ui.PriceLineScale;

public final class PriceLineScaleCheck {
    private static final double TOLERANCE = 1e-9;

    private PriceLineScaleCheck() {
    }

    public static void main(String[] args) {
        checkTone("tone true", true, PriceLineScale.Tone.GAIN);
        checkTone("tone false", false, PriceLineScale.Tone.LOSS);

        checkDomain("xDomain 48", PriceLineScale.xDomain(48), 0.0, 47.0);
        checkDomain("xDomain 2", PriceLineScale.xDomain(2), 0.0, 1.0);
        checkNull("xDomain 1", PriceLineScale.xDomain(1));
        checkNull("xDomain 0", PriceLineScale.xDomain(0));

        checkDomain("unordered points", PriceLineScale.yDomain(new double[] {3.0, 1.0, 2.0}), 1.0, 3.0);

        double[] falling = new double[48];
        for (int index = 0; index < falling.length; index++) {
            falling[index] = falling.length - index;
        }
        checkDomain("falling points", PriceLineScale.yDomain(falling), falling[falling.length - 1], falling[0]);

        checkDomain("flat positive", PriceLineScale.yDomain(new double[] {5.0, 5.0}), 4.95, 5.05);
        checkDomain("flat zero", PriceLineScale.yDomain(new double[] {0.0, 0.0}), -1.0, 1.0);
        checkDomain("flat negative", PriceLineScale.yDomain(new double[] {-2.0, -2.0}), -2.02, -1.98);

        checkNull("null points", PriceLineScale.yDomain(null));
        checkNull("empty points", PriceLineScale.yDomain(new double[0]));
        checkNull("one point", PriceLineScale.yDomain(new double[] {1.0}));
        checkNull("NaN point", PriceLineScale.yDomain(new double[] {1.0, Double.NaN}));
        checkNull("infinite point", PriceLineScale.yDomain(new double[] {1.0, Double.POSITIVE_INFINITY}));
    }

    private static void checkTone(String name, boolean up, PriceLineScale.Tone expected) {
        if (PriceLineScale.tone(up) != expected) {
            fail(name);
        }
    }

    private static void checkDomain(String name, double[] actual, double expectedMinimum, double expectedMaximum) {
        if (actual == null
                || actual.length != 2
                || !withinTolerance(actual[0], expectedMinimum)
                || !withinTolerance(actual[1], expectedMaximum)) {
            fail(name);
        }
    }

    private static boolean withinTolerance(double actual, double expected) {
        return Math.abs(actual - expected) <= TOLERANCE;
    }

    private static void checkNull(String name, double[] actual) {
        if (actual != null) {
            fail(name);
        }
    }

    private static void fail(String name) {
        System.err.println("FAILED: " + name);
        System.exit(1);
    }
}
