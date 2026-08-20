import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("node:dns", () => ({
  promises: {
    lookup: vi.fn(),
  },
}));

import { promises as dns } from "node:dns";
import { assertUrlSafe, isBlockedIP, SsrfBlockedError } from "@/lib/security/ssrf-guard";

const lookupMock = vi.mocked(dns.lookup);

describe("ssrf-guard", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("BLOCKS", () => {
    it("blocks the cloud metadata IP literal (169.254.169.254)", async () => {
      await expect(assertUrlSafe("http://169.254.169.254/latest/meta-data/")).rejects.toThrow(
        SsrfBlockedError,
      );
    });

    it("blocks localhost (resolves to loopback)", async () => {
      lookupMock.mockResolvedValue([{ address: "127.0.0.1", family: 4 }] as never);
      await expect(assertUrlSafe("http://localhost")).rejects.toThrow(SsrfBlockedError);
    });

    it("blocks the loopback IP literal (127.0.0.1)", async () => {
      await expect(assertUrlSafe("http://127.0.0.1")).rejects.toThrow(SsrfBlockedError);
    });

    it("blocks an RFC1918 10.x IP literal (10.0.0.1)", async () => {
      await expect(assertUrlSafe("http://10.0.0.1")).rejects.toThrow(SsrfBlockedError);
    });

    it("blocks an RFC1918 192.168.x IP literal (192.168.1.1)", async () => {
      await expect(assertUrlSafe("http://192.168.1.1")).rejects.toThrow(SsrfBlockedError);
    });

    it("blocks a hostname that resolves to a private IP", async () => {
      lookupMock.mockResolvedValue([{ address: "10.20.30.40", family: 4 }] as never);
      await expect(assertUrlSafe("http://internal.example.com")).rejects.toThrow(
        SsrfBlockedError,
      );
    });

    it("blocks a hostname where any resolved address is private, even if another is public", async () => {
      lookupMock.mockResolvedValue([
        { address: "8.8.8.8", family: 4 },
        { address: "192.168.0.1", family: 4 },
      ] as never);
      await expect(assertUrlSafe("http://multi-homed.example.com")).rejects.toThrow(
        SsrfBlockedError,
      );
    });

    it("blocks a non-http scheme (file://)", async () => {
      await expect(assertUrlSafe("file:///etc/passwd")).rejects.toThrow(SsrfBlockedError);
    });

    it("blocks a non-http scheme (gopher://)", async () => {
      await expect(assertUrlSafe("gopher://internal:70/")).rejects.toThrow(SsrfBlockedError);
    });

    it("blocks a malformed URL", async () => {
      await expect(assertUrlSafe("not a url")).rejects.toThrow(SsrfBlockedError);
    });

    it("blocks a hostname DNS cannot resolve (fail closed)", async () => {
      lookupMock.mockRejectedValue(new Error("ENOTFOUND"));
      await expect(assertUrlSafe("http://does-not-exist.invalid")).rejects.toThrow(
        SsrfBlockedError,
      );
    });

    it("blocks the IPv6 loopback literal (::1)", async () => {
      await expect(assertUrlSafe("http://[::1]")).rejects.toThrow(SsrfBlockedError);
    });

    it("blocks an IPv6 unique-local literal (fc00::/7)", async () => {
      await expect(assertUrlSafe("http://[fd00::1]")).rejects.toThrow(SsrfBlockedError);
    });
  });

  describe("ALLOWS", () => {
    it("allows a normal public https URL", async () => {
      lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }] as never);
      await expect(assertUrlSafe("https://example.com/page")).resolves.toEqual({
        address: "93.184.216.34",
        family: 4,
      });
    });

    it("allows a public IPv4 literal", async () => {
      await expect(assertUrlSafe("http://8.8.8.8")).resolves.toEqual({
        address: "8.8.8.8",
        family: 4,
      });
    });
  });

  describe("isBlockedIP", () => {
    it.each([
      ["10.0.0.1", true],
      ["172.16.0.1", true],
      ["172.31.255.255", true],
      ["172.32.0.1", false],
      ["192.168.1.1", true],
      ["127.0.0.1", true],
      ["169.254.169.254", true],
      ["100.64.0.1", true],
      ["8.8.8.8", false],
      ["93.184.216.34", false],
      ["::1", true],
      ["fe80::1", true],
      ["fc00::1", true],
      ["::ffff:127.0.0.1", true],
      ["2001:4860:4860::8888", false],
    ])("classifies %s as blocked=%s", (ip, expected) => {
      expect(isBlockedIP(ip)).toBe(expected);
    });
  });
});
