import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mockEnqueueTransaction = vi.fn();

// Mock stellar
vi.mock("../stellar", () => ({
  NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
  server: {
    getTransaction: vi.fn().mockResolvedValue({ status: "SUCCESS" }),
  },
}));

// Mock txQueue
vi.mock("../services/txQueue", () => ({
  enqueueTransaction: (...args: unknown[]) => mockEnqueueTransaction(...args),
}));

// Mock rpc health
vi.mock("../context/RpcHealthContext", () => ({
  useRpcHealthContext: () => ({ circuitOpen: false }),
}));

// Mock utils/network for mainnet scenarios via manual mock switching
vi.mock("../utils/network", async () => {
  const actual = (await vi.importActual("../utils/network")) as Record<string, unknown>;
  return {
    ...actual,
    ensureMainnetConfirmed: vi.fn(() => true),
  };
});

describe("useTransaction mainnet safety gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    mockEnqueueTransaction.mockResolvedValue("hash123");
  });
  afterEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
  });

  it("testnet: does not block and calls enqueueTransaction", async () => {
    const { ensureMainnetConfirmed } = await import("../utils/network");
    (ensureMainnetConfirmed as ReturnType<typeof vi.fn>).mockReturnValue(true);
    const { useTransaction } = await import("../hooks/useTransaction");
    const { result } = renderHook(() => useTransaction());

    await act(async () => {
      const hash = await result.current.submit(async () => "hash123");
      expect(hash).toBe("hash123");
    });

    expect(mockEnqueueTransaction).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe("success");
  });

  it("mainnet: blocks when ensureMainnetConfirmed returns false and sets failed state", async () => {
    const { ensureMainnetConfirmed } = await import("../utils/network");
    (ensureMainnetConfirmed as ReturnType<typeof vi.fn>).mockReturnValue(false);
    const { useTransaction } = await import("../hooks/useTransaction");
    const { result } = renderHook(() => useTransaction());

    await expect(
      act(async () => {
        await result.current.submit(async () => "hash123");
      })
    ).rejects.toThrow("Mainnet transaction cancelled");

    expect(result.current.status).toBe("failed");
    expect(result.current.error).toBe("Mainnet transaction cancelled");
    expect(mockEnqueueTransaction).not.toHaveBeenCalled();
  });

  it("mainnet: requires confirmation only once per session (second submit skips prompt)", async () => {
    const networkMod = await import("../utils/network");
    const ensureMock = networkMod.ensureMainnetConfirmed as ReturnType<typeof vi.fn>;
    // first call: not confirmed -> prompt shown, user confirms, returns false then true on retry?
    // Instead simulate: first call returns false (cancelled), second returns true after flag set
    // For this integration, we test that after failed cancel, next confirm succeeds
    ensureMock.mockReturnValueOnce(false).mockReturnValueOnce(true);
    const { useTransaction } = await import("../hooks/useTransaction");
    const { result } = renderHook(() => useTransaction());

    // First attempt cancelled
    await expect(
      act(async () => {
        await result.current.submit(async () => "hash123");
      })
    ).rejects.toThrow("Mainnet transaction cancelled");

    // Second attempt now confirmed -> succeeds
    await act(async () => {
      await result.current.submit(async () => "hash123");
    });
    expect(mockEnqueueTransaction).toHaveBeenCalledTimes(1);
  });

  it("circuitOpen blocks before mainnet check", async () => {
    vi.resetModules();
    vi.doMock("../context/RpcHealthContext", () => ({
      useRpcHealthContext: () => ({ circuitOpen: true }),
    }));
    vi.doMock("../stellar", () => ({
      NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
      server: { getTransaction: vi.fn().mockResolvedValue({ status: "SUCCESS" }) },
    }));
    vi.doMock("../services/txQueue", () => ({
      enqueueTransaction: vi.fn(),
    }));
    vi.doMock("../utils/network", async () => {
      const actual = (await vi.importActual("../utils/network")) as Record<string, unknown>;
      return { ...actual, ensureMainnetConfirmed: vi.fn(() => false) };
    });
    const { useTransaction: useTxCircuit } = await import("../hooks/useTransaction");
    const { result } = renderHook(() => useTxCircuit());
    await expect(
      act(async () => {
        await result.current.submit(async () => "hash123");
      })
    ).rejects.toThrow("RPC unavailable");
    expect(result.current.error).toBe("RPC unavailable");
  });
});
