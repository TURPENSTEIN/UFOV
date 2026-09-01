import { DIRS } from "./engine.js";
import { download } from "./storage.js";

export class UI {
  constructor({ engine, analytics, store }) {
    this.engine = engine;
    this.analytics = analytics;
    this.store = store;
    this.goal = { type: "time", minutes: 10, trials: 40, breakOn: false, breakEvery: 5, remainingMs: 0 };
    this.timerId = 0;
    this.sessionStarted = 0;
    this.lastBreak = 0;
    this._fbHide = 0;
    this._confettiRaf = 0;
  }

  mount() {
    this.els = {
      idle: $("view-idle"),
      center: $("view-response-center"),
      hint: $("view-response-hint"),
      feedback: $("view-feedback"),
      paused: $("view-paused"),
      brk: $("view-break"),
      goal: $("panel-goal"),
      settings: $("panel-settings"),
      settingsBackdrop: $("settings-backdrop"),
      progress: $("panel-progress"),
      pauseBtn: $("btn-pause"),
      skipBtn: $("btn-skip"),
      pauseLabel: $("pause-label"),
      timer: $("timer-readout"),
      status: $("status-line"),
      dots: $("block-dots"),
      sectors: $("sectors"),
    };
    this.bind();
    this.initSummaryListeners();
    this.buildSectors();
    this.syncSettingsFromEngine();
    this.engine.drawIdleGrid();
    this.engine.calibrate().then(() => this.updateStats());
    this.renderDots(0, this.engine.settings.checkSize);
    this.updateStatusLine();
    this.els.timer.textContent = "10:00";
  }

  bind() {
    $("btn-start").onclick = () => this.start();
    $("brand-home").onclick = (e) => e.preventDefault();
    $("btn-timer").onclick = () => this.toggle("goal");
    $("btn-settings").onclick = () => this.toggle("settings");
    $("btn-progress").onclick = () => this.openProgress();
    $("btn-pause").onclick = () => this.togglePause();
    $("btn-skip").onclick = () => this.engine.skip();
    $("btn-set-timer").onclick = () => this.applyGoal();
    $("btn-clear-timer").onclick = () => this.clearGoal();
    $("btn-calibrate").onclick = () => this.engine.calibrate().then(() => this.updateStats());
    $("btn-reset-session").onclick = () => this.resetSession();
    $("btn-break-resume").onclick = () => this.resumeFromBreak();
    $("btn-export-json").onclick = () => download("ufov-data.json", this.store.exportJSON(), "application/json");
    $("btn-export-csv").onclick = () => download("ufov-trials.csv", this.store.exportCSV(), "text/csv");
    $("btn-clear-history").onclick = () => {
      if (confirm("Clear all local history?")) {
        this.store.clear();
        this.openProgress();
      }
    };
    $("import-json").onchange = async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      this.store.importJSON(await file.text());
      alert("Imported.");
    };
    $("goal-break").onchange = (e) => {
      $("goal-break-every").disabled = !e.target.checked;
    };
    $("goal-type").onchange = (e) => {
      $("goal-minutes-wrap").hidden = e.target.value !== "time";
      $("goal-trials-wrap").hidden = e.target.value !== "trials";
    };
    $("set-range").oninput = (e) => {
      $("range-label").textContent = `${e.target.value}%`;
      this.pushSettings();
    };
    for (const id of [
      "set-mode",
      "set-response",
      "set-circle",
      "set-area",
      "set-dirs",
      "set-targets",
      "set-distractors",
      "set-stair",
      "set-warmup",
      "set-check",
      "set-reversals",
      "set-ecc",
      "set-fix",
      "set-mask",
      "set-start-ms",
      "set-min-ms",
      "set-max-ms",
      "set-fb-ms",
      "set-central",
      "set-gray",
      "set-noise",
    ]) {
      $(id).addEventListener("change", () => this.pushSettings());
    }

    document.querySelectorAll("[data-close]").forEach((b) => {
      b.onclick = () => this.hide(b.dataset.close);
    });
    this.els.settingsBackdrop.addEventListener("click", (e) => {
      if (e.target === this.els.settingsBackdrop) this.hide("settings");
    });
    document.querySelectorAll("[data-tabs=settings] [data-tab]").forEach((b) => {
      b.onclick = () => {
        document.querySelectorAll("[data-tabs=settings] [data-tab]").forEach((x) => x.classList.remove("active"));
        b.classList.add("active");
        ["task", "progression", "timing", "stimuli", "controls"].forEach((t) => {
          $("tab-" + t).classList.toggle("hidden", t !== b.dataset.tab);
        });
      };
    });
    document.querySelectorAll("[data-tabs=progress] [data-ptab]").forEach((b) => {
      b.onclick = () => {
        document.querySelectorAll("[data-tabs=progress] [data-ptab]").forEach((x) => x.classList.remove("active"));
        b.classList.add("active");
        document.querySelectorAll(".ptab").forEach((p) => p.classList.add("hidden"));
        $("ptab-" + b.dataset.ptab).classList.remove("hidden");
      };
    });
    document.querySelectorAll(".choice-card").forEach((btn) => {
      btn.onclick = () => this.engine.chooseCenter(Number(btn.dataset.choice));
    });

    window.addEventListener("keydown", (e) => this.onKey(e));
    window.addEventListener("resize", () => this.buildSectors());
    this.els.sectors.addEventListener("click", (e) => {
      const ray = e.target.closest("[data-dir]");
      if (!ray) return;
      this.engine.chooseTarget(Number(ray.dataset.dir));
    });
    this.els.sectors.addEventListener("mousemove", (e) => {
      const ray = e.target.closest("[data-dir]");
      this.els.sectors.querySelectorAll(".ray").forEach((r) => r.classList.toggle("hot", r === ray));
    });
  }

  onKey(e) {
    const tag = e.target.tagName;
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
    if (e.code === "Space") {
      e.preventDefault();
      if (this.engine.phase === "idle") this.start();
      else if (this.engine.phase === "break") this.resumeFromBreak();
    }
    if (e.code === "Escape") {
      if (!this.els.settingsBackdrop.classList.contains("hidden")) {
        this.hide("settings");
        return;
      }
      this.togglePause();
    }
    if (this.engine.phase === "response-center") {
      if (e.key === "a" || e.key === "A") this.engine.chooseCenter(0);
      if (e.key === "d" || e.key === "D") this.engine.chooseCenter(1);
    }
    if (this.engine.phase === "response-target") {
      const n = Number(e.key);
      if (n >= 1 && n <= 8) this.engine.chooseTarget(n - 1);
    }
  }

  pushSettings() {
    const s = {
      mode: $("set-mode").value,
      responseStyle: $("set-response").value,
      peripheralRange: Number($("set-range").value) / 100,
      circleSizePx: Number($("set-circle").value),
      stimulusArea: $("set-area").value,
      directionCount: Number($("set-dirs").value),
      peripheralTargets: Number($("set-targets").value),
      distractors: Number($("set-distractors").value),
      stair: $("set-stair").value,
      warmup: Number($("set-warmup").value),
      checkSize: Number($("set-check").value),
      reversals: Number($("set-reversals").value),
      ecc: $("set-ecc").value,
      fixationMs: Number($("set-fix").value),
      maskMs: Number($("set-mask").value),
      startMs: Number($("set-start-ms").value),
      minMs: Number($("set-min-ms").value),
      maxMs: Number($("set-max-ms").value),
      feedbackMs: Number($("set-fb-ms").value),
      central: $("set-central").value,
      grayscale: $("set-gray").value === "1",
      glyph: "Y",
      noise: Number($("set-noise").value),
    };
    if (s.stimulusArea === "square") s.stimulusArea = "circle";
    this.engine.applySettings(s);
    this.store.data.settings = s;
    this.store.save();
    this.buildSectors();
    this.renderDots(this.engine.block.length, s.checkSize);
    if (!this.engine.running) this.engine.drawIdleGrid();
    this.updateStatusLine();
  }

  syncSettingsFromEngine() {
    const saved = this.store.data?.settings; // <--- Add this line
    if (saved) {
      if (saved.stimulusArea === "square") saved.stimulusArea = "circle";
      this.engine.applySettings(saved);
    }
    const s = this.engine.settings;
    if (s.stimulusArea === "square") s.stimulusArea = "circle";
    $("set-mode").value = s.mode;
    $("set-response").value = s.responseStyle;
    $("set-range").value = Math.round(s.peripheralRange * 100);
    $("range-label").textContent = `${Math.round(s.peripheralRange * 100)}%`;
    $("set-circle").value = s.circleSizePx;
    $("set-area").value = s.stimulusArea;
    $("set-dirs").value = s.directionCount;
    $("set-targets").value = s.peripheralTargets;
    $("set-distractors").value = s.distractors;
    $("set-stair").value = s.stair;
    $("set-warmup").value = s.warmup;
    $("set-check").value = s.checkSize;
    $("set-reversals").value = s.reversals;
    $("set-ecc").value = s.ecc;
    $("set-fix").value = s.fixationMs;
    $("set-mask").value = s.maskMs;
    $("set-start-ms").value = Math.round(s.startMs);
    $("set-min-ms").value = Math.round(s.minMs);
    $("set-max-ms").value = s.maxMs;
    $("set-fb-ms").value = s.feedbackMs;
    $("set-central").value = s.central;
    $("set-gray").value = s.grayscale ? "1" : "0";
    $("set-noise").value = s.noise;
  }

  async start() {
    this.hide("goal");
    this.hide("settings");
    this.hide("progress");
    this.setView("none");
    this.els.pauseBtn.classList.remove("hidden");
    this.els.skipBtn.classList.remove("hidden");
    this.els.pauseLabel.textContent = "Pause";
    if (!this.engine.hz) await this.engine.calibrate();
    this.sessionStarted = performance.now();
    this.lastBreak = this.sessionStarted;
    if (this.goal.type === "time") this.goal.remainingMs = this.goal.minutes * 60000;
    this.tickTimer();
    this.engine.startSession({ goalLabel: this.goalLabel() });
  }

  goalLabel() {
    if (this.goal.type === "time") return `Timer · ${String(this.goal.minutes).padStart(2, "0")}:00`;
    if (this.goal.type === "trials") return `Trials · ${this.goal.trials}`;
    return "Open practice";
  }

  applyGoal() {
    this.goal.type = $("goal-type").value;
    this.goal.minutes = Number($("goal-minutes").value) || 10;
    this.goal.trials = Number($("goal-trials").value) || 40;
    this.goal.breakOn = $("goal-break").checked;
    this.goal.breakEvery = Number($("goal-break-every").value) || 5;
    if (this.goal.type === "time") {
      this.goal.remainingMs = this.goal.minutes * 60000;
      this.els.timer.textContent = fmtClock(this.goal.remainingMs);
    } else this.els.timer.textContent = "—";
    this.hide("goal");
  }

  clearGoal() {
    this.goal.type = "open";
    this.goal.remainingMs = 0;
    this.els.timer.textContent = "—";
    $("goal-type").value = "open";
  }

  tickTimer() {
    window.clearInterval(this.timerId);
    this.timerId = window.setInterval(() => {
      if (!this.engine.running || this.engine.paused || this.engine.phase === "break") return;
      if (this.goal.type === "time") {
        this.goal.remainingMs -= 250;
        this.els.timer.textContent = fmtClock(Math.max(0, this.goal.remainingMs));
        if (this.goal.remainingMs <= 0) this.finish("timer");
      }
      if (this.goal.breakOn) {
        const every = this.goal.breakEvery * 60000;
        if (performance.now() - this.lastBreak >= every) this.enterBreak();
      }
      if (this.goal.type === "trials" && (this.engine.session?.trials.length || 0) >= this.goal.trials) {
        this.finish("trials");
      }
    }, 250);
  }

  enterBreak() {
    this.lastBreak = performance.now();
    this.engine.pause();
    this.engine.phase = "break";
    this.setView("break");
    $("break-msg").textContent = `Take ${this.goal.breakEvery} minute pace — resume when ready.`;
  }

  resumeFromBreak() {
    this.lastBreak = performance.now();
    this.engine.resume();
  }

  togglePause() {
    if (!this.engine.running) return;
    if (this.engine.paused) {
      this.engine.resume();
      this.els.pauseLabel.textContent = "Pause";
    } else {
      this.engine.pause();
      this.els.pauseLabel.textContent = "Resume";
    }
  }

  resetSession() {
    if (this.engine.running) this.finish("reset");
    else {
      this.engine.stair.reset({
        rule: this.engine.settings.stair,
        minMs: this.engine.settings.minMs,
        maxMs: this.engine.settings.maxMs,
        startMs: this.engine.settings.startMs,
        frameMs: this.engine.frameMs,
        reversals: this.engine.settings.reversals,
      });
      this.updateStats();
    }
  }

  finish(reason) {
    window.clearInterval(this.timerId);
    this.engine.stopSession(reason);
    this.els.pauseBtn.classList.add("hidden");
    this.els.skipBtn.classList.add("hidden");
    this.setView("idle");
    this.els.timer.textContent = this.goal.type === "time" ? fmtClock(this.goal.minutes * 60000) : "—";
  }

  onEngine(type, payload) {
    if (type === "hud") this.onHud(payload);
    if (type === "calibrated") this.updateStats();
    if (type === "phase") this.onPhase(payload);
    if (type === "trial-complete") {
      if (this.engine.session) this.analytics.persistTrial(this.engine.session, payload);
    }
    if (type === "check") this.analytics.persistCheck(payload);
    if (type === "session-end") {
      const info = this.analytics.persistSession(payload);
      if (info?.personalBest) this.celebrateBest(info.record);
      this.showSummaryModal(info || payload);
    }
  }

  onHud(h) {
    const flashHz = h.flashMs ? Math.round(1000 / h.flashMs) : 0;
    $("stat-flash").textContent = `${flashHz}Hz (${Math.round(h.flashMs)}ms)`;
    $("stat-acc").textContent = `${Math.round(h.accuracy * 100)}%`;
    $("stat-trial").textContent = h.trialLabel;
    $("stat-hz").textContent = `${h.hz}Hz`;
    this.updateStatusLine(h);
    this.renderDots(h.blockDone, h.checkSize);
  }

  updateStatusLine(h) {
    const s = this.engine.settings;
    const ms = Math.round(h?.flashMs ?? this.engine.stair.currentMs);
    const t = h?.targets ?? s.peripheralTargets;
    const d = h?.distractors ?? (s.mode === "selective" ? s.distractors : 0);
    const done = h?.blockDone ?? this.engine.block.length;
    const size = h?.checkSize ?? s.checkSize;
    const ch = h?.lastChange ?? this.engine.lastChange;
    this.els.status.textContent = `${ms}ms  ${t}T · ${d}D  ${done}/${size}  Last change: ${ch}`;
  }

  updateStats() {
    this.engine.emitHud();
    $("stat-hz").textContent = `${this.engine.hz}Hz`;
  }

  onPhase({ name, pair, central, result }) {
    this.els.sectors.classList.toggle("hidden", name !== "response-target");
    if (name === "fixation" || name === "stimulus" || name === "mask") {
      this.clearFeedbackNow();
      this.setView("none");
      return;
    }
    if (name === "response-center") {
      this.clearFeedbackNow();
      this.setView("center");
      this.fillChoices(pair, central);
    } else if (name === "response-target") {
      this.clearFeedbackNow();
      this.setView("hint");
    } else if (name === "feedback") {
      this.els.feedback.classList.remove("leaving");
      this.setView("feedback");
      this.fillFeedback(result);
    } else if (name === "feedback-out") {
      this.els.feedback.classList.add("leaving");
      window.clearTimeout(this._fbHide);
      this._fbHide = window.setTimeout(() => this.clearFeedbackNow(), 200);
    } else if (name === "paused") {
      this.setView("paused");
    } else if (name === "idle") {
      this.clearFeedbackNow();
      this.setView("idle");
    } else {
      this.setView("none");
    }
  }

  clearFeedbackNow() {
    window.clearTimeout(this._fbHide);
    this.els.feedback.classList.add("hidden");
    this.els.feedback.classList.remove("leaving");
  }

  fillChoices(pair, central) {
    const a = $("choice-0");
    const b = $("choice-1");
    if (central === "vehicle") {
      a.textContent = "";
      b.textContent = "";
      a.innerHTML = pair[0] === "car" ? "🚗" : "🚚";
      b.innerHTML = pair[1] === "car" ? "🚗" : "🚚";
    } else {
      a.textContent = pair[0];
      b.textContent = pair[1];
    }
  }

  fillFeedback(r) {
    const title = $("feedback-title");
    const needPeriph = this.engine.settings.mode !== "processing";
    if (r.encourage) {
      title.textContent = r.encourage;
    } else if (r.warmup) {
      title.textContent = r.correct ? "Warm-up hit" : "Warm-up miss";
    } else {
      title.textContent = r.correct ? "Correct" : r.centerOk || r.targetOk ? "Partial" : "Miss";
    }
    title.className = "feedback-title " + (r.correct ? "ok" : r.centerOk || r.targetOk ? "mix" : "bad");
    paintFb($("fb-center"), r.centerOk);
    const tgt = $("fb-target");
    if (!needPeriph) {
      tgt.style.display = "none";
    } else {
      tgt.style.display = "";
      paintFb(tgt, r.targetOk);
    }
  }

  setView(name) {
    const map = {
      idle: this.els.idle,
      center: this.els.center,
      hint: this.els.hint,
      feedback: this.els.feedback,
      paused: this.els.paused,
      break: this.els.brk,
    };
    Object.entries(map).forEach(([k, el]) => el.classList.toggle("hidden", k !== name));
    if (name === "none") Object.values(map).forEach((el) => el.classList.add("hidden"));
  }

  toggle(which) {
    const open =
      which === "settings"
        ? this.els.settingsBackdrop.classList.contains("hidden")
        : which === "goal"
          ? this.els.goal.classList.contains("hidden")
          : this.els.progress.classList.contains("hidden");
    this.hide("goal");
    this.hide("settings");
    if (which !== "progress") this.hide("progress");
    if (!open) return;
    if (which === "settings") this.els.settingsBackdrop.classList.remove("hidden");
    else if (which === "goal") this.els.goal.classList.remove("hidden");
    else this.els.progress.classList.remove("hidden");
  }

  hide(which) {
    if (which === "goal") this.els.goal.classList.add("hidden");
    if (which === "settings") this.els.settingsBackdrop.classList.add("hidden");
    if (which === "progress") this.els.progress.classList.add("hidden");
  }

  openProgress() {
    this.hide("goal");
    this.hide("settings");
    this.els.progress.classList.remove("hidden");
    const roots = {
      checks: $("ptab-checks"),
      chart: $("ptab-chart"),
      sessions: $("ptab-sessions"),
      direction: $("ptab-direction"),
      decision: $("ptab-decision"),
      change: $("ptab-change"),
    };
    let dirHist = "all";
    let decHist = "session";
    const paint = () => {
      this.analytics.renderChecks(roots.checks);
      this.analytics.renderChart(roots.chart);
      this.analytics.renderSessions(roots.sessions);
      this.analytics.renderDirection(roots.direction, dirHist);
      this.analytics.renderDecision(roots.decision, decHist);
      this.analytics.renderChange(roots.change);
      const dir = $("dir-hist");
      const dec = $("dec-hist");
      if (dir) {
        dir.value = dirHist;
        dir.onchange = () => {
          dirHist = dir.value;
          paint();
        };
      }
      if (dec) {
        dec.value = decHist;
        dec.onchange = () => {
          decHist = dec.value;
          paint();
        };
      }
    };
    paint();
  }

  renderDots(done, size) {
    this.els.dots.innerHTML = Array.from({ length: size }, (_, i) => `<i class="${i < done ? "on" : ""}"></i>`).join("");
  }

  buildSectors() {
  const svg = this.els.sectors;
  const { w, h } = this.engine;
  const { cx, cy, rx, ry, circle } = this.engine.geometry();
  const n = this.engine.settings.directionCount;
  const half = 180 / n;
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  svg.style.clipPath = circle ? `circle(${rx}px at ${cx}px ${cy}px)` : "none";
  
  // Constrain ray reach to the radius bounds instead of full screen dimensions
  const pt = (deg, radx = rx, rady = ry) => {
    const a = (deg * Math.PI) / 180;
    return `${cx + Math.cos(a) * radx} ${cy - Math.sin(a) * rady}`;
  };
  
  let rays = "";
  let spokes = "";
  for (let i = 0; i < n; i++) {
    const deg = DIRS[i].deg;
    rays += `<path class="ray" data-dir="${i}" d="M ${cx} ${cy} L ${pt(deg - half)} L ${pt(deg + half)} Z"></path>`;
    spokes += `<line class="spoke" x1="${cx}" y1="${cy}" x2="${pt(deg, rx * 1.02, ry * 1.02).split(" ")[0]}" y2="${pt(deg, rx * 1.02, ry * 1.02).split(" ")[1]}" />`;
  }
  svg.innerHTML = spokes + rays;
}

  celebrateBest(record) {
    const banner = $("pb-banner");
    const detail = $("pb-detail");
    if (detail) {
      detail.textContent = `Threshold ${Math.round(record.flashEnd)}ms · ${Math.round(record.accuracy * 100)}% accuracy`;
    }
    banner.classList.remove("hidden");
    burstConfetti($("confetti"));
    window.setTimeout(() => banner.classList.add("hidden"), 4200);
  }

  showSummaryModal(stats) {
    const modal = $("summary-modal");
    if (!modal) return;

    const session = this.engine.session || stats?.session || stats || {};
    const trials = session.trials || stats?.trials || [];
    
    // 1. Calculate Accuracy
    const total = trials.length;
    const correct = trials.filter(t => t.correct).length;
    const accPct = total > 0 ? Math.round((correct / total) * 100) : Math.round(stats?.accuracy || 0);
    
    $("acc-val").textContent = `${accPct}%`;
    $("acc-sub").textContent = `${correct}/${total} correct`;

    // 2. Flash Duration Tracking
    const startMs = this.engine.settings.startMs || 500;
    const currentMs = this.engine.stair?.currentMs || stats?.currentFlash || startMs;
    const bestMs = stats?.bestFlash || currentMs;
    
    $("flash-val").innerHTML = `${Math.round(startMs)} &rarr; ${Math.round(currentMs)}ms`;
    $("flash-sub").textContent = `Best success: ${Math.round(bestMs)}ms`;

    // 3. Error Breakdown
    let cErr = 0, pErr = 0, bErr = 0;
    for (const t of trials) {
      const cOk = t.centerOk ?? t.centerCorrect;
      const pOk = t.targetOk ?? t.periphCorrect;
      if (!cOk && !pOk) bErr++;
      else if (!cOk) cErr++;
      else if (!pOk) pErr++;
    }
    const totalErr = cErr + pErr + bErr;

    $("err-val").textContent = totalErr;
    $("err-sub").textContent = `C: ${cErr} · P: ${pErr} · B: ${bErr}`;

    // 4. Time Formatting
    const durationMs = session.durationMs || (session.endTime && session.startTime ? session.endTime - session.startTime : 0) || (this.sessionStarted ? performance.now() - this.sessionStarted : 0);
    const secs = Math.max(1, Math.round(durationMs / 1000));
    const mins = Math.floor(secs / 60);
    const remSecs = secs % 60;
    
    $("dur-val").textContent = `${mins}m ${remSecs}s`;
    $("dur-sub").textContent = `${total} scored trials`;

    // 5. Weakest Sector Calculation (Fixed from .code to .name)
    let weakCode = stats?.weakestDirCode || session?.weakestDirCode;
    let weakCount = stats?.weakestCount || 0;

    if (!weakCode && trials.length > 0) {
      const dirStats = {};
      for (const t of trials) {
        const dIdx = t.dir !== undefined ? t.dir : t.targetDir;
        if (dIdx !== undefined && DIRS[dIdx]) {
          const code = DIRS[dIdx].name; // <--- Fixed: uses .name instead of .code
          if (!dirStats[code]) dirStats[code] = { errors: 0, attempts: 0 };
          dirStats[code].attempts++;
          const cOk = t.centerOk ?? t.centerCorrect;
          const pOk = t.targetOk ?? t.periphCorrect;
          if (!cOk || !pOk) dirStats[code].errors++;
        }
      }
      let maxErr = -1;
      for (const [code, stat] of Object.entries(dirStats)) {
        if (stat.errors > maxErr) {
          maxErr = stat.errors;
          weakCode = code;
          weakCount = stat.errors;
        }
      }
    }

    if (weakCode) {
      $("weak-val").textContent = weakCode;
      $("weak-sub").textContent = `${weakCount} errors recorded`;
    } else {
      $("weak-val").textContent = '—';
      $("weak-sub").textContent = 'No direction data yet';
    }

    modal.classList.remove('hidden');
  }
  hideSummaryModal() {
    const modal = $("summary-modal");
    if (modal) modal.classList.add('hidden');
  }

  initSummaryListeners() {
    $("summary-close")?.addEventListener('click', () => this.hideSummaryModal());
    $("summary-stay")?.addEventListener('click', () => this.hideSummaryModal());

    $("summary-new")?.addEventListener('click', () => {
      this.hideSummaryModal();
      this.start(); // This triggers your native reset & start sequence
    });
  }
}

function $(id) {
  return document.getElementById(id);
}

function paintFb(card, ok) {
  card.classList.toggle("ok", ok);
  card.classList.toggle("bad", !ok);
  card.querySelector(".fb-mark").textContent = ok ? "✓" : "✕";
  card.querySelector(".fb-text").textContent = ok ? "Correct" : "Wrong";
}

function fmtClock(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

function burstConfetti(canvas) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = window.innerWidth;
  const h = window.innerHeight;
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const colors = ["#a82b2b", "#b83232", "#e4e4e6", "#7b1f1f", "#d46a6a"];
  const bits = Array.from({ length: 160 }, () => ({
    x: w * 0.5 + (Math.random() - 0.5) * 80,
    y: h * 0.28,
    vx: (Math.random() - 0.5) * 14,
    vy: -6 - Math.random() * 10,
    rot: Math.random() * Math.PI,
    spin: (Math.random() - 0.5) * 0.4,
    w: 6 + Math.random() * 6,
    h: 8 + Math.random() * 8,
    color: colors[(Math.random() * colors.length) | 0],
    life: 1,
  }));
  const t0 = performance.now();
  const tick = (now) => {
    const elapsed = now - t0;
    ctx.clearRect(0, 0, w, h);
    for (const b of bits) {
      b.vy += 0.28;
      b.x += b.vx;
      b.y += b.vy;
      b.rot += b.spin;
      b.life = Math.max(0, 1 - elapsed / 2200);
      ctx.save();
      ctx.globalAlpha = b.life;
      ctx.translate(b.x, b.y);
      ctx.rotate(b.rot);
      ctx.fillStyle = b.color;
      ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h);
      ctx.restore();
    }
    if (elapsed < 2300) requestAnimationFrame(tick);
    else ctx.clearRect(0, 0, w, h);
  };
  requestAnimationFrame(tick);
}
