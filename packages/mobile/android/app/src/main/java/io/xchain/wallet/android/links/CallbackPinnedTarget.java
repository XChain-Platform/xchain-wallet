/*
 * Copyright © 2025–2026 Dankest, LLC
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package io.xchain.wallet.android.links;

import java.io.IOException;
import java.net.Inet6Address;
import java.net.InetAddress;
import java.net.Socket;
import java.net.URI;
import java.net.URISyntaxException;
import java.net.URL;
import java.net.UnknownHostException;
import java.util.Arrays;
import java.util.Collections;
import java.util.Locale;
import javax.net.ssl.HostnameVerifier;
import javax.net.ssl.SNIHostName;
import javax.net.ssl.SSLParameters;
import javax.net.ssl.SSLSocket;
import javax.net.ssl.SSLSocketFactory;

public final class CallbackPinnedTarget {

    private CallbackPinnedTarget() {}

    public static URL pinnedUrl(String href, InetAddress address) {
        if (href == null || address == null) {
            throw new IllegalArgumentException("Callback target and address are required");
        }

        URI uri = parse(href);
        if (!"https".equalsIgnoreCase(uri.getScheme())
                || uri.getRawUserInfo() != null
                || uri.getRawFragment() != null) {
            throw new IllegalArgumentException("Invalid callback target");
        }

        HostSpan host = hostSpan(href, uri);
        String literal = stripBrackets(host.value);
        if (isIpLiteral(literal)
                && !Arrays.equals(literalAddress(literal), address.getAddress())) {
            throw new IllegalArgumentException("Callback address does not match target");
        }

        String replacement = address.getHostAddress();
        if (address instanceof Inet6Address) replacement = "[" + replacement + "]";
        try {
            return new URL(href.substring(0, host.start) + replacement + href.substring(host.end));
        } catch (IOException error) {
            throw new IllegalArgumentException("Invalid callback target", error);
        }
    }

    public static String hostHeader(String href) {
        URI uri = parse(href);
        HostSpan host = hostSpan(href, uri);
        int port = uri.getPort();
        return port == -1 || port == 443 ? host.value : host.value + ":" + port;
    }

    public static String serverName(String href) {
        URI uri = parse(href);
        String host = stripBrackets(hostSpan(href, uri).value);
        return isIpLiteral(host) ? null : host.toLowerCase(Locale.ROOT);
    }

    public static SSLSocketFactory withServerName(SSLSocketFactory base, String serverName) {
        if (serverName == null) return base;
        return new SSLSocketFactory() {
            @Override
            public String[] getDefaultCipherSuites() {
                return base.getDefaultCipherSuites();
            }

            @Override
            public String[] getSupportedCipherSuites() {
                return base.getSupportedCipherSuites();
            }

            @Override
            public Socket createSocket() throws IOException {
                return configure(base.createSocket(), serverName);
            }

            @Override
            public Socket createSocket(String host, int port) throws IOException {
                return configure(base.createSocket(host, port), serverName);
            }

            @Override
            public Socket createSocket(
                    String host,
                    int port,
                    InetAddress localAddress,
                    int localPort
            ) throws IOException {
                return configure(
                        base.createSocket(host, port, localAddress, localPort),
                        serverName
                );
            }

            @Override
            public Socket createSocket(InetAddress host, int port) throws IOException {
                return configure(base.createSocket(host, port), serverName);
            }

            @Override
            public Socket createSocket(
                    InetAddress address,
                    int port,
                    InetAddress localAddress,
                    int localPort
            ) throws IOException {
                return configure(
                        base.createSocket(address, port, localAddress, localPort),
                        serverName
                );
            }

            @Override
            public Socket createSocket(
                    Socket socket,
                    String host,
                    int port,
                    boolean autoClose
            ) throws IOException {
                return configure(base.createSocket(socket, host, port, autoClose), serverName);
            }
        };
    }

    public static HostnameVerifier verifierFor(String host, HostnameVerifier base) {
        return (ignored, session) -> base.verify(host, session);
    }

    private static Socket configure(Socket socket, String serverName) {
        SSLSocket sslSocket = (SSLSocket) socket;
        SSLParameters parameters = sslSocket.getSSLParameters();
        parameters.setServerNames(Collections.singletonList(new SNIHostName(serverName)));
        sslSocket.setSSLParameters(parameters);
        return sslSocket;
    }

    private static URI parse(String href) {
        if (href == null) throw new IllegalArgumentException("Callback target is required");
        try {
            return new URI(href);
        } catch (URISyntaxException error) {
            throw new IllegalArgumentException("Invalid callback target", error);
        }
    }

    private static HostSpan hostSpan(String href, URI uri) {
        String authority = uri.getRawAuthority();
        if (authority == null || uri.getHost() == null) {
            throw new IllegalArgumentException("Callback target requires a host");
        }

        int authorityStart = href.indexOf(':') + 1;
        if (!href.startsWith("//", authorityStart)) {
            throw new IllegalArgumentException("Callback target requires an authority");
        }
        authorityStart += 2;

        int relativeHostStart = uri.getRawUserInfo() == null
                ? 0
                : uri.getRawUserInfo().length() + 1;
        String hostAndPort = authority.substring(relativeHostStart);
        int hostLength;
        if (hostAndPort.startsWith("[")) {
            int close = hostAndPort.indexOf(']');
            if (close < 0) throw new IllegalArgumentException("Invalid callback host");
            hostLength = close + 1;
        } else {
            int portSeparator = uri.getPort() == -1 ? -1 : hostAndPort.lastIndexOf(':');
            hostLength = portSeparator == -1 ? hostAndPort.length() : portSeparator;
        }
        if (hostLength == 0) throw new IllegalArgumentException("Callback target requires a host");
        int hostStart = authorityStart + relativeHostStart;
        return new HostSpan(
                hostStart,
                hostStart + hostLength,
                hostAndPort.substring(0, hostLength)
        );
    }

    private static String stripBrackets(String host) {
        return host.startsWith("[") && host.endsWith("]")
                ? host.substring(1, host.length() - 1)
                : host;
    }

    private static boolean isIpLiteral(String host) {
        if (host.indexOf(':') >= 0) return true;
        String[] parts = host.split("\\.", -1);
        if (parts.length != 4) return false;
        for (String part : parts) {
            if (part.isEmpty()) return false;
            for (int index = 0; index < part.length(); index++) {
                if (!Character.isDigit(part.charAt(index))) return false;
            }
        }
        return true;
    }

    private static byte[] literalAddress(String literal) {
        if (literal.indexOf(':') < 0) {
            String[] parts = literal.split("\\.", -1);
            byte[] address = new byte[4];
            for (int index = 0; index < parts.length; index++) {
                try {
                    int value = Integer.parseInt(parts[index]);
                    if (value > 255) throw new IllegalArgumentException("Invalid callback IP literal");
                    address[index] = (byte) value;
                } catch (NumberFormatException error) {
                    throw new IllegalArgumentException("Invalid callback IP literal", error);
                }
            }
            return address;
        }
        try {
            return InetAddress.getByName(literal).getAddress();
        } catch (UnknownHostException error) {
            throw new IllegalArgumentException("Invalid callback IP literal", error);
        }
    }

    private static final class HostSpan {
        private final int start;
        private final int end;
        private final String value;

        private HostSpan(int start, int end, String value) {
            this.start = start;
            this.end = end;
            this.value = value;
        }
    }
}
