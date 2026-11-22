package io.xchain.wallet.android.wear.ui;

public final class InscribedSquare {
    private InscribedSquare() {
    }

    public static double side(double diameter) {
        if (!Double.isFinite(diameter) || diameter <= 0.0) {
            return 0.0;
        }
        return diameter / Math.sqrt(2.0);
    }

    public static double inset(double diameter) {
        if (!Double.isFinite(diameter) || diameter <= 0.0) {
            return 0.0;
        }
        return (diameter - side(diameter)) / 2.0;
    }

    public static double[] fit(double diameter, double margin) {
        if (!Double.isFinite(diameter) || !Double.isFinite(margin) || margin < 0.0) {
            return null;
        }

        double shrunkDiameter = diameter - 2.0 * margin;
        if (!Double.isFinite(shrunkDiameter) || shrunkDiameter <= 0.0) {
            return null;
        }

        double side = side(shrunkDiameter);
        double inset = margin + (shrunkDiameter - side) / 2.0;
        return new double[] {inset, inset, side};
    }
}
