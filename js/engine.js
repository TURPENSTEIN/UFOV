import { AdaptiveStaircase } from "./staircase.js";

export const DIRS = [
  { id: 0, deg: 0, name: "E", label: "East" },
  { id: 1, deg: 45, name: "NE", label: "North-East" },
  { id: 2, deg: 90, name: "N", label: "North" },
  { id: 3, deg: 135, name: "NW", label: "North-West" },
  { id: 4, deg: 180, name: "W", label: "West" },
  { id: 5, deg: 225, name: "SW", label: "South-West" },
  { id: 6, deg: 270, name: "S", label: "South" },
  { id: 7, deg: 315, name: "SE", label: "South-East" },
];

export const EMOJIS = ["🐵", "🐸", "😺", "🐶", "🦊", "🐼", "🐨", "🐯", "🐰", "🐮"];

export const DEFAULT_SETTINGS = {
  mode: "selective",
  responseStyle: "two-step",
  peripheralRange: 0.92,
  circleSizePx: 62,
  stimulusArea: "fullscreen",
  directionCount: 8,
  peripheralTargets: 1,
  distractors: 20,
  stair: "3down1up",
  warmup: 5,
  checkSize: 4,
  reversals: 6,
  ecc: "all",
  fixationMs: 500,
  maskMs: 500,
  startMs: 106,
  minMs: 16.67,
  maxMs: 500,
  feedbackMs: 700,
  central: "emoji",
  grayscale: true,
  glyph: "Y",
  noise: 55,
};

const ECC = { inner: 10 / 30, middle: 20 / 30, outer: 1 };

export class UfovEngine {
  constructor(canvas, emit) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
    this.emit = emit;
    this.settings = { ...DEFAULT_SETTINGS };
    this.stair = new AdaptiveStaircase();
    this.raf = 0;
    this.hz = 60;
    this.frameMs = 1000 / 60;
    this.running = false;
    this.paused = false;
    this.phase = "idle";
    this.session = null;
    this.trial = null;
    this.block = [];
    this.lastChange = "—";
    this.scatter = [];
    this.winStreak = 0;
    this.loseStreak = 0;
    this._boundResize = () => this.resize();
    this.resize();
    window.addEventListener("resize", this._boundResize);
  }

  destroy() {
    this.stopLoop();
    window.removeEventListener("resize", this._boundResize);
  }

  applySettings(partial) {
    Object.assign(this.settings, partial);
    if (this.settings.stimulusArea === "square") this.settings.stimulusArea = "circle";
    this.settings.glyph = "Y";
    this.stair.minMs = this.settings.minMs;
    this.stair.maxMs = this.settings.maxMs;
    this.stair.rule = this.settings.stair;
    this.stair.nDown = this.settings.stair === "2down1up" ? 2 : 3;
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = w;
    this.h = h;
    if (this.phase === "idle" || this.phase === "paused") this.drawIdleGrid();
  }

  geometry() {
    const { w, h, settings } = this;
    const cx = w / 2;
    const cy = h / 2;
    const range = settings.peripheralRange;
    const circle = settings.stimulusArea === "circle";
    const rx = circle ? Math.min(w, h) * 0.5 * range : (w * 0.5 - 18) * range;
    const ry = circle ? rx : (h * 0.5 - 18) * range;
    return { cx, cy, rx, ry, maxR: Math.max(rx, ry), box: settings.circleSizePx, circle };
  }

  async calibrate(samples = 90) {
    this.emit("calibrating", { samples });
    const times = [];
    await new Promise((resolve) => {
      let last = performance.now();
      const tick = (now) => {
        times.push(now - last);
        last = now;
        if (times.length >= samples) resolve();
        else this.raf = requestAnimationFrame(tick);
      };
      this.raf = requestAnimationFrame(tick);
    });
    const trimmed = times.slice(10).sort((a, b) => a - b);
    const mid = trimmed[Math.floor(trimmed.length / 2)] || 16.67;
    this.frameMs = mid;
    this.hz = Math.round(1000 / mid);
    this.stair.setFrameMs(this.frameMs);
    this.emit("calibrated", { hz: this.hz, frameMs: this.frameMs });
    return this.hz;
  }

  startSession(meta = {}) {
    this.running = true;
    this.paused = false;
    this.session = {
      id: crypto.randomUUID(),
      startedAt: new Date().toISOString(),
      settings: { ...this.settings },
      trials: [],
      checks: [],
      meta,
    };
    this.block = [];
    this.lastChange = "—";
    this.winStreak = 0;
    this.loseStreak = 0;
    this.stair.reset({
      rule: this.settings.stair,
      minMs: this.settings.minMs,
      maxMs: this.settings.maxMs,
      startMs: this.settings.startMs,
      frameMs: this.frameMs,
      reversals: this.settings.reversals,
    });
    this.emit("session-start", this.session);
    this.nextTrial();
  }

  stopSession(reason = "stop") {
    this.running = false;
    this.paused = false;
    this.stopLoop();
    this.phase = "idle";
    const session = this.session;
    if (session) {
      session.endedAt = new Date().toISOString();
      session.reason = reason;
      session.threshold = this.stair.threshold(this.settings.reversals);
    }
    this.drawIdleGrid();
    this.emit("session-end", session);
    this.session = null;
  }

  pause() {
    if (!this.running || this.paused) return;
    this.paused = true;
    this.stopLoop();
    this.phase = "paused";
    this.emit("phase", { name: "paused" });
  }

  resume() {
    if (!this.running || !this.paused) return;
    this.paused = false;
    this.nextTrial();
  }

  skip() {
    if (!this.running || this.paused) return;
    this.stopLoop();
    this._completeTrial({ skipped: true, centerOk: false, targetOk: false, correct: false });
  }

  nextTrial() {
    if (!this.running || this.paused) return;
    const s = this.settings;
    const n = this.session.trials.length + 1;
    const warmup = n <= s.warmup;
    const dirs = DIRS.slice(0, s.directionCount);
    const eccKey = s.ecc === "all" ? pick(["inner", "middle", "outer"]) : s.ecc;
    const dir = pick(dirs);
    const pair =
      s.central === "vehicle"
        ? ["car", "truck"]
        : (() => {
            const a = pick(EMOJIS);
            let b = pick(EMOJIS);
            while (b === a) b = pick(EMOJIS);
            return [a, b];
          })();
    const centerId = Math.random() < 0.5 ? 0 : 1;
    const geo = this.geometry();
    const ecc = ECC[eccKey];
    const targetR = { rx: geo.rx * ecc, ry: geo.ry * ecc };
    const distractors = [];
    if (s.mode === "selective") {
      const count = s.distractors;
      for (let i = 0; i < count; i++) {
        const d = pick(dirs);
        const ring = pick(["inner", "middle", "outer"]);
        const k = ECC[ring] * (0.55 + Math.random() * 0.45);
        const rx = geo.rx * k;
        const ry = geo.ry * k;
        if (d.id === dir.id && Math.abs(k - ecc) < 0.12) continue;
        distractors.push({ deg: d.deg, rx, ry, jitter: (Math.random() - 0.5) * 22 });
      }
    }
    this.trial = {
      n,
      warmup,
      pair,
      centerId,
      dir: dir.id,
      deg: dir.deg,
      ecc: eccKey,
      r: targetR,
      distractors,
      flashMs: this.stair.currentMs,
      frames: this.stair.frames,
      tStim: 0,
      tMask: 0,
      responseStarted: 0,
      emojiMs: null,
      targetMs: null,
      centerChoice: null,
      targetChoice: null,
    };
    this.phase = "fixation";
    this.frameCount = 0;
    this.fixFrames = msToFrames(s.fixationMs, this.frameMs);
    this.stimFrames = this.trial.frames;
    this.maskFrames = msToFrames(s.maskMs, this.frameMs);
    this.emit("trial-start", this.trial);
    this.emit("phase", { name: "fixation" });
    this.emitHud();
    this.loop();
  }

  loop() {
    this.stopLoop();
    const step = () => {
      if (!this.running || this.paused) return;
      this.frameCount += 1;
      if (this.phase === "fixation") {
        this.drawFixation();
        if (this.frameCount >= this.fixFrames) {
          this.phase = "stimulus";
          this.frameCount = 0;
          this.trial.tStim = performance.now();
          this.drawStimulus();
        }
      } else if (this.phase === "stimulus") {
        if (this.frameCount >= this.stimFrames) {
          this.trial.actualMs = performance.now() - this.trial.tStim;
          this.phase = "mask";
          this.frameCount = 0;
          this.seedScatter();
          this.drawMask();
        }
      } else if (this.phase === "mask") {
        this.drawMask();
        if (this.frameCount >= this.maskFrames) {
          this.stopLoop();
          this.beginResponse();
          return;
        }
      }
      this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }

  beginResponse() {
    this.trial.responseStarted = performance.now();
    this.clearStage();
    const twoStep = this.settings.responseStyle === "two-step" && this.settings.mode !== "processing";
    const needPeriph = this.settings.mode !== "processing" && this.settings.responseStyle !== "center-only";
    if (this.settings.mode === "processing" || this.settings.responseStyle === "center-only" || twoStep) {
      this.phase = "response-center";
      this.emit("phase", { name: "response-center", pair: this.trial.pair, central: this.settings.central });
    } else if (needPeriph) {
      this.phase = "response-target";
      this.emit("phase", { name: "response-target" });
    }
  }

  chooseCenter(index) {
    if (this.phase !== "response-center") return;
    this.trial.centerChoice = index;
    this.trial.emojiMs = performance.now() - this.trial.responseStarted;
    const needPeriph =
      this.settings.mode !== "processing" && this.settings.responseStyle !== "center-only";
    if (needPeriph) {
      this.phase = "response-target";
      this.trial.targetPromptAt = performance.now();
      this.emit("phase", { name: "response-target" });
    } else {
      this._completeTrial(this._score());
    }
  }

  chooseTarget(dirId) {
    if (this.phase !== "response-target") return;
    this.trial.targetChoice = dirId;
    const start = this.trial.targetPromptAt || this.trial.responseStarted;
    this.trial.targetMs = performance.now() - start;
    this._completeTrial(this._score());
  }

  _score() {
    const t = this.trial;
    const s = this.settings;
    const centerOk = t.centerChoice === t.centerId;
    const needPeriph = s.mode !== "processing" && s.responseStyle !== "center-only";
    const targetOk = needPeriph ? t.targetChoice === t.dir : true;
    return {
      centerOk,
      targetOk,
      correct: centerOk && targetOk,
      skipped: false,
    };
  }

  _completeTrial(score) {
    const t = this.trial;
    const result = {
      ...score,
      n: t.n,
      warmup: t.warmup,
      flashMs: t.flashMs,
      actualMs: t.actualMs,
      dir: t.dir,
      ecc: t.ecc,
      pair: t.pair,
      centerId: t.centerId,
      emojiMs: t.emojiMs,
      targetMs: t.targetMs,
      totalMs: (t.emojiMs || 0) + (t.targetMs || 0),
      mode: this.settings.mode,
    };
    if (!t.warmup && !score.skipped) {
      const adj = this.stair.record(score.correct);
      this.lastChange = adj.change;
      result.change = adj.change;
      result.threshold = adj.threshold;
      if (score.correct) {
        this.winStreak += 1;
        this.loseStreak = 0;
      } else {
        this.loseStreak += 1;
        this.winStreak = 0;
      }
      result.winStreak = this.winStreak;
      result.loseStreak = this.loseStreak;
      result.encourage = pickEncourage(this.winStreak, this.loseStreak, score.correct);
    } else {
      result.change = "—";
    }
    this.session.trials.push(result);
    this.block.push(result);
    if (this.block.length >= this.settings.checkSize) {
      const scored = this.block.filter((x) => !x.warmup && !x.skipped);
      const hits = scored.filter((x) => x.correct).length;
      const check = {
        at: new Date().toISOString(),
        sessionId: this.session.id,
        trials: `${hits}/${this.block.length}`,
        hit: hits,
        total: this.block.length,
        flashFrom: this.block[0].flashMs,
        flashTo: this.stair.currentMs,
        change: this.lastChange,
        mode: this.settings.mode,
        settings: summarizeSettings(this.settings),
        centerAcc: avg(this.block.map((x) => (x.centerOk ? 1 : 0))),
        periAcc: avg(this.block.filter((x) => x.targetOk !== undefined).map((x) => (x.targetOk ? 1 : 0))),
      };
      this.session.checks.push(check);
      this.emit("check", check);
      this.block = [];
    }
    this.emit("trial-complete", result);
    this.emitHud();
    this.showFeedback(result);
  }

  showFeedback(result) {
    this.phase = "feedback";
    this.emit("phase", { name: "feedback", result });
    this.stopLoop();
    window.clearTimeout(this._fbTimer);
    const fade = 200;
    this._fbTimer = window.setTimeout(() => {
      this.emit("phase", { name: "feedback-out" });
      this._fbTimer = window.setTimeout(() => {
        if (!this.running || this.paused) return;
        this.nextTrial();
      }, fade);
    }, this.settings.feedbackMs);
  }

  emitHud() {
    const s = this.settings;
    const acc = this.session
      ? avg(this.session.trials.filter((t) => !t.warmup).map((t) => (t.correct ? 1 : 0)))
      : 0;
    const scored = this.session?.trials.filter((t) => !t.warmup).length || 0;
    const warmupLeft = Math.max(0, s.warmup - (this.session?.trials.length || 0));
    this.emit("hud", {
      flashMs: this.stair.currentMs,
      hz: this.hz,
      targets: s.peripheralTargets,
      distractors: s.mode === "selective" ? s.distractors : 0,
      blockDone: this.block.length,
      checkSize: s.checkSize,
      lastChange: this.lastChange,
      accuracy: acc,
      trialLabel:
        warmupLeft > 0
          ? `W ${(this.session?.trials.length ?? 0) + 1}/${s.warmup}`
          : String(scored + 1),
      threshold: this.stair.threshold(s.reversals),
    });
  }

  stopLoop() {
    if (this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
  }

  drawIdleGrid() {
    this.clearStage();
    this.drawField();
  }

  clearStage() {
    this.ctx.fillStyle = "#0e0e10";
    this.ctx.fillRect(0, 0, this.w, this.h);
  }

  withClip(fn) {
    const geo = this.geometry();
    this.ctx.save();
    if (geo.circle) {
      this.ctx.beginPath();
      this.ctx.arc(geo.cx, geo.cy, geo.rx, 0, Math.PI * 2);
      this.ctx.clip();
    }
    fn(geo);
    this.ctx.restore();
  }

  drawField() {
    const geo = this.geometry();
    if (!geo.circle) return;
    this.ctx.save();
    this.ctx.strokeStyle = "rgba(228,228,230,0.22)";
    this.ctx.lineWidth = 1.5;
    this.ctx.beginPath();
    this.ctx.arc(geo.cx, geo.cy, geo.rx, 0, Math.PI * 2);
    this.ctx.stroke();
    this.ctx.restore();
  }

  drawSpokes(alpha = 0.12) {
    const { cx, cy } = this.geometry();
    const n = this.settings.directionCount;
    const maxRadius = Math.min(cx, cy) * 0.85;

    this.ctx.save();
    this.ctx.strokeStyle = `rgba(228, 228, 230, ${alpha})`;
    this.ctx.lineWidth = 1;
    
    for (let i = 0; i < n; i++) {
      const rad = (DIRS[i].deg * Math.PI) / 180;
      this.ctx.beginPath();
      this.ctx.moveTo(cx, cy);
      this.ctx.lineTo(cx + Math.cos(rad) * maxRadius, cy - Math.sin(rad) * maxRadius);
      this.ctx.stroke();
    }
    this.ctx.restore();
  }

  drawFixation() {
    this.clearStage();
    this.withClip(() => {
      this.drawField();
      this.drawSpokes(0.1);
      const { cx, cy, box } = this.geometry();
      this.ctx.strokeStyle = "rgba(228,228,230,0.55)";
      this.ctx.lineWidth = 2;
      this.ctx.beginPath();
      this.ctx.moveTo(cx - 8, cy);
      this.ctx.lineTo(cx + 8, cy);
      this.ctx.moveTo(cx, cy - 8);
      this.ctx.lineTo(cx, cy + 8);
      this.ctx.stroke();
      this.ctx.strokeStyle = "rgba(228,228,230,0.18)";
      this.ctx.strokeRect(cx - box / 2, cy - box / 2, box, box);
    });
    this.drawField();
  }

  drawStimulus() {
    this.clearStage();
    this.withClip(() => {
      this.drawSpokes(0.08);
      const { cx, cy, box } = this.geometry();
      const t = this.trial;
      const s = this.settings;
      if (s.grayscale) this.ctx.filter = "grayscale(1)";
      this.drawCenter(cx, cy, box, t.pair[t.centerId]);
      this.ctx.filter = "none";
      if (s.mode !== "processing") {
        this.drawTarget(cx, cy, t.deg, t.r);
        if (s.mode === "selective") {
          for (const d of t.distractors) this.drawDistractor(cx, cy, d);
        }
      }
    });
    this.drawField();
  }

  drawCenter(cx, cy, box, item) {
    this.ctx.strokeStyle = "rgba(255,255,255,0.35)";
    this.ctx.strokeRect(cx - box / 2, cy - box / 2, box, box);
    if (item === "car" || item === "truck") {
      drawVehicle(this.ctx, cx, cy, box * 0.42, item === "truck");
      return;
    }
    this.ctx.font = `${Math.floor(box * 0.72)}px "Segoe UI Emoji", sans-serif`;
    this.ctx.textAlign = "center";
    this.ctx.textBaseline = "middle";
    this.ctx.fillText(item, cx, cy + 2);
  }

  drawTarget(cx, cy, deg, r) {
    const rad = (deg * Math.PI) / 180;
    const x = cx + Math.cos(rad) * r.rx;
    const y = cy - Math.sin(rad) * r.ry;
    this.ctx.fillStyle = "#e4e4e6";
    this.ctx.font = "700 22px ui-sans-serif, sans-serif";
    this.ctx.textAlign = "center";
    this.ctx.textBaseline = "middle";
    this.ctx.fillText("X", x, y);
  }

  drawDistractor(cx, cy, d) {
    const rad = (d.deg * Math.PI) / 180;
    const x = cx + Math.cos(rad) * d.rx + d.jitter;
    const y = cy - Math.sin(rad) * d.ry + d.jitter * 0.35;
    this.ctx.fillStyle = "#e4e4e6";
    this.ctx.font = "18px ui-sans-serif, sans-serif";
    this.ctx.textAlign = "center";
    this.ctx.textBaseline = "middle";
    this.ctx.fillText("Y", x, y);
  }

  seedScatter() {
    const n = 40 + Math.round((this.settings.noise / 100) * 90);
    this.scatter = Array.from({ length: n }, () => ({
      x: Math.random() * this.w,
      y: Math.random() * this.h,
      vx: (Math.random() - 0.5) * 1.8,
      vy: (Math.random() - 0.5) * 1.6,
      ch: Math.random() < 0.5 ? "X" : "Y",
      size: 14 + Math.random() * 18,
      alpha: 0.18 + Math.random() * 0.45,
      rot: Math.random() * Math.PI,
      spin: (Math.random() - 0.5) * 0.08,
    }));
  }

  drawMask() {
    const ctx = this.ctx;
    const g = ctx.createRadialGradient(this.w / 2, this.h / 2, 20, this.w / 2, this.h / 2, Math.max(this.w, this.h) * 0.7);
    g.addColorStop(0, "#16161a");
    g.addColorStop(0.55, "#0e0e10");
    g.addColorStop(1, "#08080a");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.w, this.h);
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const p of this.scatter) {
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.spin;
      if (p.x < -20) p.x = this.w + 20;
      if (p.x > this.w + 20) p.x = -20;
      if (p.y < -20) p.y = this.h + 20;
      if (p.y > this.h + 20) p.y = -20;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.globalAlpha = p.alpha;
      ctx.fillStyle = "#d8d8dc";
      ctx.font = `700 ${p.size}px ui-sans-serif, sans-serif`;
      ctx.fillText(p.ch, 0, 0);
      ctx.restore();
    }
    ctx.restore();
  }
}

function pickEncourage(win, lose, correct) {
  if (correct && win >= 3 && Math.random() < 0.22) {
    return pick(["Unstoppable!", "Sharp Focus!", "Lock in!"]);
  }
  if (!correct && lose >= 3 && Math.random() < 0.22) {
    return pick(["Reset & Go!", "Stay Sharp!"]);
  }
  return null;
}

function pick(arr) {
  return arr[(Math.random() * arr.length) | 0];
}

function avg(xs) {
  if (!xs.length) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function msToFrames(ms, frameMs) {
  return Math.max(1, Math.round(ms / frameMs));
}

function summarizeSettings(s) {
  const style = s.responseStyle === "two-step" ? "two step" : s.responseStyle;
  const field = s.stimulusArea === "circle" ? "circle" : "full field";
  return `${style} · ${field} · ${s.directionCount} dirs · ${s.peripheralTargets} target · ${s.distractors} distractors`;
}

function drawVehicle(ctx, cx, cy, s, truck) {
  ctx.fillStyle = "#d7dbe6";
  ctx.strokeStyle = "#d7dbe6";
  ctx.lineWidth = 2;
  if (truck) {
    ctx.fillRect(cx - s, cy - s * 0.25, s * 1.7, s * 0.7);
    ctx.fillRect(cx + s * 0.2, cy - s * 0.7, s * 0.55, s * 0.5);
  } else {
    ctx.beginPath();
    ctx.moveTo(cx - s, cy + s * 0.2);
    ctx.lineTo(cx - s * 0.4, cy + s * 0.2);
    ctx.lineTo(cx - s * 0.15, cy - s * 0.45);
    ctx.lineTo(cx + s * 0.45, cy - s * 0.45);
    ctx.lineTo(cx + s * 0.8, cy + s * 0.2);
    ctx.lineTo(cx + s, cy + s * 0.2);
    ctx.lineTo(cx + s, cy + s * 0.45);
    ctx.lineTo(cx - s, cy + s * 0.45);
    ctx.closePath();
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(cx - s * 0.45, cy + s * 0.5, s * 0.18, 0, Math.PI * 2);
  ctx.arc(cx + s * 0.45, cy + s * 0.5, s * 0.18, 0, Math.PI * 2);
  ctx.fill();
}
// 1. Add this helper function in engine.js
function drawRadialLines(ctx, cx, cy, maxRadius) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)'; 
    ctx.lineWidth = 1;
    
    for (let i = 0; i < 8; i++) {
        const angle = i * (Math.PI / 4);
        const x = cx + maxRadius * Math.cos(angle);
        const y = cy + maxRadius * Math.sin(angle);
        
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(x, y);
        ctx.stroke();
    }
    ctx.restore();
}

// 2. Call it inside your main requestAnimationFrame render loop
function renderFrame() {
    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Define center and max radius based on your canvas dimensions
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const maxRadius = Math.min(cx, cy) * 0.85; // Adjust scaling factor to match your layout bounds
    
    // Draw the radial alignment grid first
    drawRadialLines(ctx, cx, cy, maxRadius);
    
    // Render the rest of your UFOV elements (fixation, peripheral targets, distractors)
    drawFixation(ctx, cx, cy);
    drawStimuli(ctx);
    
    requestAnimationFrame(renderFrame);
}