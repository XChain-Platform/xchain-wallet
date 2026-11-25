/*
 * Copyright © 2025–2026 Dankest, LLC
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import Foundation
import Security

@main
struct CallbackPinnedTrustCheck {
    private static let caBase64 = """
    MIIDAjCCAeqgAwIBAgIUFYUwqw7EgeIkE7nSVtpVFRIdoagwDQYJKoZIhvcNAQELBQAwITEfMB0GA1UEAwwWQ2FsbGJhY2sgVHJ1c3QgVGVzdCBDQTAeFw0yNjExMjQxODQxMjVaFw0zNjExMjExODQxMjVaMCExHzAdBgNVBAMMFkNhbGxiYWNrIFRydXN0IFRlc3QgQ0EwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQCT9SG8u0x6GmpPmotibbk5PJwhW4iBhZgQvkoWqag/K1oBQ1vxBGxR/wFaYYJnRMFGfPUZZkH7BfsXR+9yTYO2p8CkLwCL9OZFH3zKd7BXwv9Kez0AVnjf73EszSZ+0s26bvRe6dejn7MDwNUFQML1qqMjOquvRp99/+SwXOs6UY4mkNIV5PlNYWR5fpWcyiJ/sF3SQrQe0cvgBTiL0CfBJxOrrfoamK5u1ZFbTVFTlgQn5KYlnPDEXJKKrkRMK4Xxa962DATBRxdkYjuy1jlok45fuxpQBKB+pOOixohHZp2zrgIe8QffIsWNmpLUaJW0/jfqHFiNyyMIkPhNYJVPAgMBAAGjMjAwMB0GA1UdDgQWBBS+DoTFV07O7y82ws2++Hl9c3Pg4TAPBgNVHRMBAf8EBTADAQH/MA0GCSqGSIb3DQEBCwUAA4IBAQCQKPFm5x6etmzhBtYtSF3qNapQDsfTDAiSnXZRD03Mjm+h0swk88KDsuzlkOChTGp9u/f9hhLocr+N/qpvHNX+I50TUZMBY/m/rHfFhOKY47wD/Ncpx8YCsOS4l1xcPKC1fItp4IILVZtJ8c18haJdDb0tSty1u2XtThnc4LceBntlFUrFePZo3Frez0e9kNdjZjU+WU1z8ADQZbnWAj51xRozxVW1uMAqeido4HJGySS1kDHvnRI4f+dccx7B2uepQXnAwwx0kmhm2KkUOg9PUwUrCh9g7fYV+LRPYGYC4Iz6tdwwqe0x5jXQI2+3GpTuKgpSz/ji6uf2iYc9tI2P
    """
    private static let leafBase64 = """
    MIIDRDCCAiygAwIBAgIUaeTdMHoEhikKWOAwoyJPropIWkswDQYJKoZIhvcNAQELBQAwITEfMB0GA1UEAwwWQ2FsbGJhY2sgVHJ1c3QgVGVzdCBDQTAeFw0yNjExMjQxODQxMjVaFw0yNzEyMjYxODQxMjVaMBsxGTAXBgNVBAMMEGNhbGxiYWNrLmV4YW1wbGUwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQCYeEdUqfp3E2tTPSfmLedCayV9XewGIt6+zO8gUYxIGP54H3R0v5MjjMOB1wqKU6iBWlESExkzl73MXjJGJas99i9CJzVWOkhAMb3CigQbOkEFDlykTFOQFEZQ6TIeufOo5JOOmQOZv6jrF7Vuj4a8qfKX1nMp2AfS+SGAzLQPN7TdKh9ohcPMZSJDPutzolvktb5HkWEN1kaNw5ldEG+R8tL/52smtzeTPiV9eucuYbwwrI67mUX5DbhMmah1gBWvhp7vZybaYnnvrfbus9rfxAUIpv/YMG0p94zALTpJWdCLiGj0fJ8vMHSf4RJQMUFqYldCP3G935yuwrZl3ClVAgMBAAGjejB4MCEGA1UdEQQaMBiCEGNhbGxiYWNrLmV4YW1wbGWHBMAAAgowEwYDVR0lBAwwCgYIKwYBBQUHAwEwHQYDVR0OBBYEFLAoG82ddf03B85TOzLa9/fzv4w6MB8GA1UdIwQYMBaAFL4OhMVXTs7vLzbCzb74eX1zc+DhMA0GCSqGSIb3DQEBCwUAA4IBAQAjvoBgfN6PJzk31o6XNtwZXCoWqGR7ND4BeHMEEESfVfO3FAlJUoqLsBEM6jWMZvcxEm/801RlHHk+YIyydNuNrUP4bqaW3fduHOtQOwBTFVoEw5lSgF175D2aIjzwZI+hfGArv/LouTpiGXF3mejxnbZ6fMhCHZs/rAOhX6hyYBSzFzA/OR+hUR+n9q0qgMAzZZdm0cKnzxmy2kQ4A4MHMlKXeTGw5wpxbvhc0fEpz3xpYEfD85hyu5Xno/XeR7nKiud1dYHzKNmVE/ulfOO359cU2UU6cQLRbXgKYTdFzO1ouEmekTkTLqt8JTs4Lv4F7035il0eVAN8Urrslrzs
    """
    private static let validDate = Date(timeIntervalSince1970: 1_795_632_085)
    private static let expiredDate = Date(timeIntervalSince1970: 1_829_932_885)
    private static var passed = 0

    static func main() {
        check("DNS name", evaluate("callback.example"))
        check("IP address", evaluate("192.0.2.10"))
        check("other DNS name", !evaluate("other.example"))
        check("other IP address", !evaluate("192.0.2.11"))
        check("empty name", !evaluate(""))
        check("missing anchor", !evaluate("callback.example", anchored: false))
        check("expired certificate", !evaluate("callback.example", date: expiredDate))

        let accepted = CallbackPinnedTrust.disposition(
            method: NSURLAuthenticationMethodServerTrust,
            trust: freshTrust(),
            name: "callback.example"
        )
        check("accepted disposition", accepted.0 == .useCredential && accepted.1 != nil)

        let rejected = CallbackPinnedTrust.disposition(
            method: NSURLAuthenticationMethodServerTrust,
            trust: freshTrust(),
            name: "other.example"
        )
        check("rejected disposition", rejected.0 == .cancelAuthenticationChallenge && rejected.1 == nil)

        let missing = CallbackPinnedTrust.disposition(
            method: NSURLAuthenticationMethodServerTrust,
            trust: nil,
            name: "callback.example"
        )
        check("nil trust disposition", missing.0 == .cancelAuthenticationChallenge && missing.1 == nil)

        let otherMethod = CallbackPinnedTrust.disposition(
            method: NSURLAuthenticationMethodHTTPBasic,
            trust: freshTrust(),
            name: "callback.example"
        )
        check("other method disposition", otherMethod.0 == .performDefaultHandling && otherMethod.1 == nil)

        check("DNS trust name", trustName("https://Example.COM/cb", [8, 8, 8, 8]) == "example.com")
        check("IPv4 trust name", trustName("https://8.8.8.8/cb", [8, 8, 8, 8]) == "8.8.8.8")
        check(
            "IPv6 trust name",
            trustName("https://[2001:db8::1]/cb", [
                0x20, 0x01, 0x0d, 0xb8, 0, 0, 0, 0,
                0, 0, 0, 0, 0, 0, 0, 1,
            ]) == "2001:db8::1"
        )

        print("CallbackPinnedTrustCheck: \(passed) passed, 0 failed")
    }

    private static func evaluate(
        _ name: String,
        anchored: Bool = true,
        date: Date = validDate
    ) -> Bool {
        CallbackPinnedTrust.evaluate(freshTrust(anchored: anchored, date: date), name: name)
    }

    private static func freshTrust(
        anchored: Bool = true,
        date: Date = validDate
    ) -> SecTrust {
        let leaf = certificate(leafBase64, name: "leaf certificate")
        let ca = certificate(caBase64, name: "CA certificate")
        var trust: SecTrust?
        guard SecTrustCreateWithCertificates(leaf, SecPolicyCreateBasicX509(), &trust) == errSecSuccess,
              let trust
        else {
            fail("create trust")
        }
        let anchors = anchored ? [ca] : []
        guard SecTrustSetAnchorCertificates(trust, anchors as CFArray) == errSecSuccess else {
            fail("set anchors")
        }
        SecTrustSetAnchorCertificatesOnly(trust, true)
        SecTrustSetNetworkFetchAllowed(trust, false)
        SecTrustSetVerifyDate(trust, date as CFDate)
        return trust
    }

    private static func certificate(_ encoded: String, name: String) -> SecCertificate {
        guard let data = Data(base64Encoded: encoded, options: .ignoreUnknownCharacters),
              let certificate = SecCertificateCreateWithData(nil, data as CFData)
        else {
            fail(name)
        }
        return certificate
    }

    private static func trustName(_ href: String, _ address: [UInt8]) -> String? {
        CallbackPinnedTarget.make(href: href, address: address).map(CallbackPinnedTrust.trustName)
    }

    private static func check(_ name: String, _ condition: @autoclosure () -> Bool) {
        guard condition() else { fail(name) }
        passed += 1
    }

    private static func fail(_ name: String) -> Never {
        FileHandle.standardError.write(Data("FAILED: \(name)\n".utf8))
        exit(1)
    }
}
