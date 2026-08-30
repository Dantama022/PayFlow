import { describe, it, expect, vi, beforeEach } from "vitest";
import { xdr, nativeToScVal } from "@stellar/stellar-sdk";

// Mock rpc Server
const mockSim = vi.fn();
const mockGetAccount = vi.fn().mockResolvedValue({ id: "mock" } as unknown as never);

vi.mock("@stellar/stellar-sdk/rpc", () => ({
  Server: class {
    getAccount = mockGetAccount;
    simulateTransaction = mockSim;
    getTransaction = vi.fn();
    getEvents = vi.fn();
    sendTransaction = vi.fn();
    getHealth = vi.fn();
  },
  assembleTransaction: vi.fn((tx) => tx),
}));

function makeI128ScVal(n: bigint): xdr.ScVal {
  return nativeToScVal(n, { type: "i128" });
}
function makeOptionI128ScVal(n: bigint | null): xdr.ScVal {
  if (n === null) {
    // Option None is ScVal void
    return xdr.ScVal.scvVoid();
  }
  // For Option Some, Soroban returns the inner ScVal directly in some SDK versions
  // Safer to return i128 directly — decoder handles both via decodeOption
  return makeI128ScVal(n);
}
function makeU64OptionScVal(n: bigint | null): xdr.ScVal {
  if (n === null) return xdr.ScVal.scvVoid();
  return nativeToScVal(n, { type: "u64" });
}
function makeVoid(): xdr.ScVal {
  return xdr.ScVal.scvVoid();
}

describe("stellar daily limit helpers (Issue 050)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAccount.mockResolvedValue({ id: "GABC" } as unknown as never);
  });

  it("getDailyLimit returns Some limit", async () => {
    const fakeRetval = makeOptionI128ScVal(100_000_000n);
    mockSim.mockResolvedValue({ result: { retval: fakeRetval } } as never);
    const { getDailyLimit } = await import("../stellar");
    const val = await getDailyLimit("GABC0000000000000000000000000000000000000000000000000000");
    expect(val).toBe(100_000_000n);
  });

  it("getDailyLimit returns null when None", async () => {
    mockSim.mockResolvedValue({ result: { retval: makeVoid() } } as never);
    const { getDailyLimit: getLimit2 } = await import("../stellar");
    // Need fresh import to bypass deduped cache key? Use same function but different user to avoid cache
    const val = await getLimit2("GDEF0000000000000000000000000000000000000000000000000000");
    expect(val).toBeNull();
  });

  it("getDailySpent returns 0 when retval missing", async () => {
    mockSim.mockResolvedValue({ result: {} } as never);
    const { getDailySpent } = await import("../stellar");
    const val = await getDailySpent("GHIJ0000000000000000000000000000000000000000000000000000");
    expect(val).toBe(0n);
  });

  it("getDailySpent decodes i128", async () => {
    mockSim.mockResolvedValue({ result: { retval: makeI128ScVal(70_000_000n) } } as never);
    const { getDailySpent: getSpent2 } = await import("../stellar");
    const val = await getSpent2("GKLM0000000000000000000000000000000000000000000000000000");
    expect(val).toBe(70_000_000n);
  });

  it("getDayStart returns timestamp when Some", async () => {
    mockSim.mockResolvedValue({ result: { retval: makeU64OptionScVal(123456789n) } } as never);
    const { getDayStart } = await import("../stellar");
    const val = await getDayStart("GNOP0000000000000000000000000000000000000000000000000000");
    expect(val).toBe(123456789n);
  });

  it("getDayStart returns null when None/void", async () => {
    mockSim.mockResolvedValue({ result: { retval: makeVoid() } } as never);
    const { getDayStart: getStart2 } = await import("../stellar");
    const val = await getStart2("GQRS0000000000000000000000000000000000000000000000000000");
    expect(val).toBeNull();
  });

  it("getDailyLimitStatus computes remaining and dayActive", async () => {
    // Need to mock three sequential simulate calls for getDailyLimit, getDailySpent, getDayStart
    // getDailyLimit: Some 100M, getDailySpent: 70M, getDayStart: Some timestamp
    // Use a queue of mock returns in order
    mockSim
      .mockResolvedValueOnce({ result: { retval: makeOptionI128ScVal(100_000_000n) } } as never)
      .mockResolvedValueOnce({ result: { retval: makeI128ScVal(70_000_000n) } } as never)
      .mockResolvedValueOnce({ result: { retval: makeU64OptionScVal(999n) } } as never);
    const { getDailyLimitStatus } = await import("../stellar");
    const status = await getDailyLimitStatus(
      "GTUV0000000000000000000000000000000000000000000000000000"
    );
    expect(status.limit).toBe(100_000_000n);
    expect(status.spent).toBe(70_000_000n);
    expect(status.remaining).toBe(30_000_000n);
    expect(status.dayActive).toBe(true);
    expect(status.dayStart).toBe(999n);
  });

  it("getDailyLimitStatus remaining null when no limit", async () => {
    mockSim
      .mockResolvedValueOnce({ result: { retval: makeVoid() } } as never)
      .mockResolvedValueOnce({ result: { retval: makeI128ScVal(5_000_000n) } } as never)
      .mockResolvedValueOnce({ result: { retval: makeVoid() } } as never);
    const { getDailyLimitStatus: getStatus2 } = await import("../stellar");
    const status = await getStatus2("GWXY0000000000000000000000000000000000000000000000000000");
    expect(status.limit).toBeNull();
    expect(status.remaining).toBeNull();
    expect(status.dayActive).toBe(false);
  });
});
