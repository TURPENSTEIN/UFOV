/** 3-Down/1-Up (~79.4%) or 2-Down/1-Up (~70.7%) adaptive staircase. */

export class AdaptiveStaircase {
  constructor(opts = {}) {
    this.reset(opts);
  }

  reset(opts = {}) {
    const o = { ...this._opts, ...opts };
    this._opts = o;
    this.rule = o.rule === "2down1up" ? "2down1up" : "3down1up";
    this.nDown = this.rule === "2down1up" ? 2 : 3;
    this.minMs = o.minMs ?? 16.67;
    this.maxMs = o.maxMs ?? 500;
    this.frameMs = o.frameMs ?? 1000 / 60;
    this.durationMs = this._snap(o.startMs ?? 106);
    this.consecutiveCorrect = 0;
    this.lastDirection = 0;
    this.reversals = [];
    this.history = [];
    this.stepIndex = 0;
    this.multipliers = [2, 2, Math.SQRT2, Math.SQRT2, 1.25, 1.25];
  }

  get frames() {
    return Math.max(1, Math.round(this.durationMs / this.frameMs));
  }

  get currentMs() {
    return this.frames * this.frameMs;
  }

  setFrameMs(frameMs) {
    this.frameMs = frameMs;
    this.durationMs = this._snap(this.durationMs);
  }

  record(correct) {
    const before = this.currentMs;
    let change = "No change";
    let reversed = false;

    if (correct) {
      this.consecutiveCorrect += 1;
      if (this.consecutiveCorrect >= this.nDown) {
        this.consecutiveCorrect = 0;
        reversed = this._step(-1);
        change = "Faster";
      }
    } else {
      this.consecutiveCorrect = 0;
      reversed = this._step(1);
      change = "Slower";
    }

    const after = this.currentMs;
    this.history.push({ correct, before, after, change, reversed });
    return {
      durationMs: after,
      frames: this.frames,
      change,
      reversed,
      threshold: this.threshold(),
    };
  }

  threshold(n) {
    const need = n ?? this._opts.reversals ?? 6;
    const rev = this.reversals.slice(-need);
    if (!rev.length) return this.currentMs;
    return rev.reduce((a, b) => a + b.mid, 0) / rev.length;
  }

  _step(dir) {
    const prevDir = this.lastDirection;
    const factor = this.multipliers[Math.min(this.stepIndex, this.multipliers.length - 1)];
    let next;
    if (dir < 0) next = this.durationMs / factor;
    else next = this.durationMs * factor;

    const oneFrame = this.frameMs;
    if (this.reversals.length >= 4) {
      next = dir < 0 ? this.durationMs - oneFrame : this.durationMs + oneFrame;
    }

    next = this._clamp(this._snap(next));
    const reversed = prevDir !== 0 && prevDir !== dir && next !== this.durationMs;
    if (reversed) {
      this.reversals.push({
        from: this.durationMs,
        to: next,
        mid: (this.durationMs + next) / 2,
      });
      this.stepIndex += 1;
    }
    this.lastDirection = dir;
    this.durationMs = next;
    return reversed;
  }

  _snap(ms) {
    const frames = Math.max(1, Math.round(ms / this.frameMs));
    return frames * this.frameMs;
  }

  _clamp(ms) {
    return Math.min(this.maxMs, Math.max(this.minMs, ms));
  }
}
