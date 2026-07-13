import { afterEach, describe, expect, it, vi } from "vitest";
import { IdleShutdown } from "./lifecycle.js";

afterEach(() => vi.useRealTimers());

describe("IdleShutdown", () => {
  it("does not shut down before the first browser has connected", () => {
    vi.useFakeTimers();
    const onIdle = vi.fn();
    const idle = new IdleShutdown(15_000, onIdle);

    idle.roomBecameEmpty();
    vi.advanceTimersByTime(30_000);

    expect(onIdle).not.toHaveBeenCalled();
  });

  it("shuts down after the final browser leaves", () => {
    vi.useFakeTimers();
    const onIdle = vi.fn();
    const idle = new IdleShutdown(15_000, onIdle);

    idle.clientConnected();
    idle.roomBecameEmpty();
    vi.advanceTimersByTime(14_999);
    expect(onIdle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);

    expect(onIdle).toHaveBeenCalledOnce();
  });

  it("cancels shutdown when a refresh reconnects during the grace period", () => {
    vi.useFakeTimers();
    const onIdle = vi.fn();
    const idle = new IdleShutdown(15_000, onIdle);

    idle.clientConnected();
    idle.roomBecameEmpty();
    vi.advanceTimersByTime(8_000);
    idle.clientConnected();
    vi.advanceTimersByTime(30_000);

    expect(onIdle).not.toHaveBeenCalled();
  });
});
