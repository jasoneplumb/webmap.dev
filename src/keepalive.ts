export class Keepalive {
  private wakeLock: WakeLockSentinel | null = null;
  private audioCtx: AudioContext | null = null;
  private sourceNode: AudioBufferSourceNode | null = null;

  async start(): Promise<void> {
    await this.acquireWakeLock();
    this.startSilentAudio();
  }

  stop(): void {
    this.wakeLock?.release().catch(() => undefined);
    this.wakeLock = null;
    this.sourceNode?.stop();
    this.audioCtx?.close().catch(() => undefined);
    this.audioCtx = null;
    this.sourceNode = null;
  }

  async reacquireWakeLock(): Promise<void> {
    if (this.wakeLock === null || this.wakeLock.released) {
      await this.acquireWakeLock();
    }
  }

  private async acquireWakeLock(): Promise<void> {
    if (!('wakeLock' in navigator)) return;
    try {
      this.wakeLock = await navigator.wakeLock.request('screen');
    } catch {
      // Permission denied or not supported — silent degradation
    }
  }

  private startSilentAudio(): void {
    try {
      this.audioCtx = new AudioContext();
      const buffer = this.audioCtx.createBuffer(1, 1, 22050);
      const source = this.audioCtx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.connect(this.audioCtx.destination);
      source.start();
      this.sourceNode = source;
    } catch {
      // AudioContext unavailable — silent degradation
    }
  }
}
