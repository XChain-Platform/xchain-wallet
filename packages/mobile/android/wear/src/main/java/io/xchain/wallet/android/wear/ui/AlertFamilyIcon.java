package io.xchain.wallet.android.wear.ui;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

public final class AlertFamilyIcon {
    public static final String FALLBACK_ICON = "BellIcon";
    public static final Map<String, String> PHONE_ICONS;

    static {
        Map<String, String> icons = new LinkedHashMap<>();
        icons.put("txConfirmations", "SendIcon");
        icons.put("incomingReceipts", "DownloadIcon");
        icons.put("incomingPending", "ClockIcon");
        icons.put("messages", "MessageIcon");
        icons.put("governancePolls", "ListIcon");
        icons.put("deadlines", "BellIcon");
        icons.put("dispenserEscrow", "CoinsIcon");
        icons.put("dispenserFills", "TokenIcon");
        icons.put("orderFills", "LineChartIcon");
        icons.put("priceAlerts", "BellIcon");
        icons.put("request", "DocumentIcon");
        icons.put("paydue", "ClockIcon");
        PHONE_ICONS = Collections.unmodifiableMap(icons);
    }

    private AlertFamilyIcon() {}

    public static String phoneIcon(String family) {
        if (family == null || family.isEmpty()) {
            return FALLBACK_ICON;
        }
        return PHONE_ICONS.getOrDefault(family, FALLBACK_ICON);
    }

    public static String drawableName(String family) {
        String icon = phoneIcon(family);
        String name = icon.endsWith("Icon")
                ? icon.substring(0, icon.length() - "Icon".length())
                : icon;
        StringBuilder drawable = new StringBuilder("ic_family_");
        for (int index = 0; index < name.length(); index++) {
            char character = name.charAt(index);
            if (index > 0 && Character.isUpperCase(character)) {
                drawable.append('_');
            }
            drawable.append(Character.toLowerCase(character));
        }
        return drawable.toString();
    }
}
