/**
 * Arms shutdown only after a browser has connected at least once. A short grace period keeps
 * refreshes, hot reloads, and momentary network drops from tearing down the local AI stack.
 */
export class IdleShutdown {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private hadClient = false;

  constructor(
    private readonly delayMs: number,
    private readonly onIdle: () => void,
  ) {}

  clientConnected(): void {
    this.hadClient = true;
    this.cancel();
  }

  roomBecameEmpty(): void {
    if (!this.hadClient || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.onIdle();
    }, this.delayMs);
  }

  cancel(): void {
    if (!this.timer) return;
    clearTimeout(this.timer);
    this.timer = null;
  }
}
