import { DIRS } from "./engine.js";
import { relativeTime, pillClass, dayKey } from "./storage.js";

export class Analytics {
  constructor(store) {
    this.store = store;
  }

  persistTrial(session, result) {
    this.store.data.trials.push({
      at: new Date().toISOString(),
      sessionId: session.id,
      n: result.n,
      mode: result.mode,
      warmup: result.warmup,
      correct: result.correct,
      centerOk: result.centerOk,
      targetOk: result.targetOk,
      flashMs: result.flashMs,
      dir: result.dir,
      ecc: result.ecc,
      emojiMs: result.emojiMs,
      targetMs: result.targetMs,
      totalMs: result.totalMs,
    });
    this.store.bumpActivity();
    this.store.save();
  }

  persistCheck(check) {
    this.store.data.checks.unshift(check);
    this.store.data.checks = this.store.data.checks.slice(0, 400);
    this.store.save();
  }

  persistSession(session) {
    if (!session?.trials?.length) return;
    const trials = session.trials.filter((t) => !t.skipped);
    const scored = trials.filter((t) => !t.warmup);
    const early = scored.slice(0, Math.max(1, Math.floor(scored.length / 2)));
    const late = scored.slice(Math.floor(scored.length / 2));
    const rec = {
      id: session.id,
      at: session.startedAt,
      endedAt: session.endedAt,
      goal: session.meta?.goalLabel || "Open practice",
      settings: summarize(session.settings),
      trialsDone: scored.length,
      trialsTotal: trials.length,
      flashStart: trials[0]?.flashMs ?? session.settings.startMs,
      flashEnd: session.threshold ?? trials.at(-1)?.flashMs,
      accuracy: mean(scored.map((t) => (t.correct ? 1 : 0))),
      center: mean(scored.map((t) => (t.centerOk ? 1 : 0))),
      peripheral: mean(scored.map((t) => (t.targetOk ? 1 : 0))),
      durationMs: new Date(session.endedAt).getTime() - new Date(session.startedAt).getTime(),
      earlyAcc: mean(early.map((t) => (t.correct ? 1 : 0))),
      lateAcc: mean(late.map((t) => (t.correct ? 1 : 0))),
      earlyRt: mean(early.map((t) => t.totalMs).filter(Boolean)),
      lateRt: mean(late.map((t) => t.totalMs).filter(Boolean)),
      mode: session.settings.mode,
    };
    rec.result = changeLabel(rec.earlyAcc, rec.lateAcc);
    rec.personalBest = this.registerBest(rec);
    this.store.data.sessions.unshift(rec);
    this.store.save();
    return { record: rec, personalBest: rec.personalBest };
  }

  registerBest(rec) {
    if (rec.trialsDone < 8 || rec.flashEnd == null) return false;
    const prev = this.store.data.bestThreshold;
    if (prev == null || rec.flashEnd < prev - 0.4) {
      this.store.data.bestThreshold = rec.flashEnd;
      return true;
    }
    return false;
  }

  render(rootMap, filter = "all") {
    this.renderChecks(rootMap.checks);
    this.renderChart(rootMap.chart);
    this.renderSessions(rootMap.sessions);
    this.renderDirection(rootMap.direction, filter);
    this.renderDecision(rootMap.decision, filter);
    this.renderChange(rootMap.change);
  }

  renderChecks(el) {
    const rows = this.store.data.checks
      .slice(0, 40)
      .map((c) => {
        const acc = c.total ? Math.round((c.hit / c.total) * 100) : 0;
        const flash =
          Math.abs(c.flashTo - c.flashFrom) < 0.5
            ? `${fmtMs(c.flashFrom)}`
            : `${fmtMs(c.flashFrom)} → ${fmtMs(c.flashTo)}`;
        const ch =
          c.change === "Faster"
            ? `<span class="pill purple">Faster</span>`
            : c.change === "Slower"
              ? `<span class="pill warn">Slower</span>`
              : `<span class="pill">No change</span>`;
        return `<tr>
          <td>${relativeTime(c.at)}</td>
          <td>Mode • ${modeName(c.mode)}</td>
          <td>${esc(c.settings)}</td>
          <td>${c.trials}</td>
          <td>${flash}</td>
          <td><span class="pill ${pillClass(acc)}">${acc}%</span></td>
          <td><span class="pill ${pillClass(c.centerAcc * 100)}">${pct(c.centerAcc)}</span></td>
          <td><span class="pill ${pillClass(c.periAcc * 100)}">${pct(c.periAcc)}</span></td>
          <td>${ch}</td>
        </tr>`;
      })
      .join("");
    el.innerHTML = table(
      ["Date", "Mode", "Settings", "Trials", "Flash", "Accuracy", "Center", "Peripheral", "Change"],
      rows,
      "No checks yet. Complete a 4-trial block to see results."
    );
  }

  renderChart(el) {
    el.innerHTML = `
      <div class="filter-row"><h2 style="margin:0">Progress Chart</h2>
        <label class="field" style="margin:0;min-width:180px"><span>Metric</span>
          <select id="chart-metric"><option>Flash + accuracy</option></select>
        </label>
      </div>
      <div class="cal-wrap" id="cal-grid"></div>
      <div class="chart-box"><canvas id="progress-canvas" width="1100" height="360"></canvas>
        <p class="note">Lower flash is plotted higher in the combined view.</p>
      </div>`;
    this.drawCalendar(el.querySelector("#cal-grid"));
    this.drawLine(el.querySelector("#progress-canvas"));
  }

  drawCalendar(host) {
    const weeks = 53;
    const cells = [];
    const today = new Date();
    const start = new Date(today);
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7) - (weeks - 1) * 7);
    for (let i = 0; i < weeks * 7; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const k = dayKey(d);
      const n = this.store.data.activity[k] || 0;
      const lvl = n === 0 ? "" : n < 8 ? "l1" : n < 20 ? "l2" : n < 40 ? "l3" : "l4";
      cells.push(`<div class="cal-cell ${lvl}" title="${k}: ${n} trials"></div>`);
    }
    host.innerHTML = `<div class="cal-grid">${cells.join("")}</div>
      <p class="note">Less <span class="cal-cell"></span> <span class="cal-cell l1"></span> <span class="cal-cell l3"></span> More</p>`;
  }

  drawLine(canvas) {
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;
    ctx.fillStyle = "#141820";
    ctx.fillRect(0, 0, w, h);
    const sessions = [...this.store.data.sessions].reverse().slice(-24);
    const pad = { l: 48, r: 56, t: 20, b: 36 };
    const iw = w - pad.l - pad.r;
    const ih = h - pad.t - pad.b;
    ctx.strokeStyle = "#2a3140";
    ctx.fillStyle = "#9aa3b5";
    ctx.font = "12px Segoe UI";
    for (let i = 0; i <= 4; i++) {
      const y = pad.t + (ih * i) / 4;
      ctx.beginPath();
      ctx.moveTo(pad.l, y);
      ctx.lineTo(w - pad.r, y);
      ctx.stroke();
      ctx.fillText(`${100 - i * 25}%`, 8, y + 4);
    }
    const flashes = sessions.map((s) => s.flashEnd || 106);
    const fMin = 16;
    const fMax = Math.max(360, ...flashes, 1);
    ctx.fillStyle = "#9aa3b5";
    for (let i = 0; i <= 4; i++) {
      const ms = fMin + ((fMax - fMin) * i) / 4;
      const y = pad.t + ih - (ih * i) / 4;
      ctx.fillText(`${Math.round(ms)}ms`, w - 50, y + 4);
    }
    ctx.setLineDash([6, 6]);
    ctx.strokeStyle = "#fbbf24";
    let y = pad.t + ih * (1 - 0.75);
    ctx.beginPath();
    ctx.moveTo(pad.l, y);
    ctx.lineTo(w - pad.r, y);
    ctx.stroke();
    ctx.strokeStyle = "#f87171";
    y = pad.t + ih * (1 - 0.5);
    ctx.beginPath();
    ctx.moveTo(pad.l, y);
    ctx.lineTo(w - pad.r, y);
    ctx.stroke();
    ctx.setLineDash([]);
    if (!sessions.length) return;
    const xAt = (i) => pad.l + (sessions.length === 1 ? iw / 2 : (iw * i) / (sessions.length - 1));
    const accY = (a) => pad.t + ih * (1 - a);
    const flashY = (ms) => pad.t + ih * (1 - (ms - fMin) / (fMax - fMin));
    drawSeries(
      ctx,
      sessions.map((s, i) => [xAt(i), flashY(invert(s.flashEnd || 106, fMin, fMax))]),
      "#a78bfa"
    );
    drawSeries(
      ctx,
      sessions.map((s, i) => [xAt(i), accY(s.accuracy || 0)]),
      "#34d399"
    );
    ctx.fillStyle = "#9aa3b5";
    sessions.forEach((s, i) => {
      if (i % Math.max(1, Math.ceil(sessions.length / 6)) === 0) {
        const d = new Date(s.at);
        ctx.fillText(`${d.toLocaleString("en", { month: "short", day: "numeric" })}`, xAt(i) - 16, h - 12);
      }
    });
  }

  renderSessions(el) {
    const rows = this.store.data.sessions
      .map((s) => {
        const acc = Math.round(s.accuracy * 100);
        return `<tr>
          <td>${relativeTime(s.at)}</td>
          <td>${esc(s.goal)}</td>
          <td>${esc(s.settings)}</td>
          <td>${s.trialsDone}/${Math.max(s.trialsTotal, s.trialsDone)}</td>
          <td>${fmtMs(s.flashStart)} → ${fmtMs(s.flashEnd)}</td>
          <td><span class="pill ${pillClass(acc)}">${acc}%</span></td>
          <td><span class="pill ${pillClass(s.center * 100)}">${pct(s.center)}</span></td>
          <td><span class="pill ${pillClass(s.peripheral * 100)}">${pct(s.peripheral)}</span></td>
          <td style="color:#93c5fd">${fmtDur(s.durationMs)}</td>
        </tr>`;
      })
      .join("");
    el.innerHTML = table(
      ["Date", "Goal", "Settings", "Trials", "Flash", "Accuracy", "Center", "Peripheral", "Duration"],
      rows,
      "No sessions stored yet."
    );
  }

  renderDirection(el, hist) {
    const trials = this._trialSlice(hist).filter((t) => t.dir != null && !t.warmup);
    const by = new Map();
    for (const d of DIRS) by.set(d.id, { d, n: 0, ok: 0 });
    for (const t of trials) {
      const b = by.get(t.dir);
      if (!b) continue;
      b.n += 1;
      if (t.targetOk) b.ok += 1;
    }
    const cell = (id) => {
      const b = by.get(id);
      const ready = b.n >= 5;
      const p = ready ? Math.round((b.ok / b.n) * 100) : null;
      const cls = p == null ? "" : p >= 60 ? "gold" : "red";
      return `<div class="dir-cell ${cls}"><div>${b.d.name}</div><div class="pct">${p == null ? "—" : p + "%"}</div><div>${b.d.label}</div></div>`;
    };
    const tableRows = [...by.values()]
      .sort((a, b) => b.n - a.n)
      .map((b) => {
        const p = b.n ? Math.round((b.ok / b.n) * 100) : 0;
        const status = b.n < 5 ? "Collecting" : p >= 60 ? "Developing" : "Needs work";
        const color = b.n < 5 ? "" : p >= 60 ? "gold" : "red";
        return `<tr><td>${b.d.name} - ${b.d.label}</td><td>${b.n}</td><td>${b.ok}</td>
          <td class="${color}">${b.n ? p + "%" : "—"}</td><td>${status}</td></tr>`;
      })
      .join("");
    el.innerHTML = `
      <div class="filter-row">
        <div><h2 style="margin:0">Direction Performance</h2>
          <p class="note">Accuracy appears after 5 attempts in a direction.</p></div>
        <label class="field" style="margin:0"><span>History</span>
          <select id="dir-hist"><option value="all">All history</option>
            <option value="session">Latest session</option></select></label>
      </div>
      <div class="dir-grid">
        ${cell(3)}${cell(2)}${cell(1)}
        ${cell(4)}<div class="dir-cell core">PERIPHERAL FIELD</div>${cell(0)}
        ${cell(5)}${cell(6)}${cell(7)}
      </div>
      ${table(["Direction", "Attempts", "Correct", "Accuracy", "Status"], tableRows, "")}`;
  }

  renderDecision(el, hist) {
    const trials = this._trialSlice(hist).filter((t) => !t.warmup).slice(-80).reverse();
    const tot = trials.map((t) => t.totalMs).filter((n) => n > 0);
    const em = trials.map((t) => t.emojiMs).filter((n) => n > 0);
    const tg = trials.map((t) => t.targetMs).filter((n) => n > 0);
    const ok = trials.filter((t) => t.correct).map((t) => t.totalMs).filter((n) => n > 0);
    const miss = trials.filter((t) => !t.correct).map((t) => t.totalMs).filter((n) => n > 0);
    const rows = trials
      .map(
        (t) => `<tr>
        <td>${relativeTime(t.at)}</td><td>#${t.n}</td>
        <td>${t.correct ? "Correct" : "Miss"}</td>
        <td>${fmtRt(t.emojiMs)}</td><td>${fmtRt(t.targetMs)}</td><td>${fmtRt(t.totalMs)}</td>
        <td>Two step</td></tr>`
      )
      .join("");
    el.innerHTML = `
      <div class="filter-row"><h2 style="margin:0">Decision Time</h2>
        <label class="field" style="margin:0"><span>History</span>
          <select id="dec-hist"><option value="session">Latest session</option>
            <option value="all">All history</option></select></label></div>
      <div class="cards">
        <div class="card"><span>MEDIAN TOTAL</span><strong>${fmtRt(median(tot))}</strong></div>
        <div class="card"><span>MEDIAN EMOJI</span><strong>${fmtRt(median(em))}</strong></div>
        <div class="card"><span>MEDIAN TARGET</span><strong>${fmtRt(median(tg))}</strong></div>
        <div class="card"><span>CORRECT VS MISS</span><strong>${fmtRt(median(ok))} / ${fmtRt(median(miss))}</strong></div>
      </div>
      ${table(["Date", "Trial", "Result", "Emoji", "Target", "Total", "Style"], rows, "No decision times yet.")}`;
  }

  renderChange(el) {
    const sessions = this.store.data.sessions.slice(0, 10);
    const latest = sessions[0];
    const rows = sessions
      .map(
        (s) => `<tr>
        <td>${relativeTime(s.at)}</td><td>${s.trialsDone}</td>
        <td>${pct(s.earlyAcc)}</td><td>${pct(s.lateAcc)}</td>
        <td>${fmtRt(s.earlyRt)}</td><td>${fmtRt(s.lateRt)}</td>
        <td><span class="pill blue">${s.result}</span></td></tr>`
      )
      .join("");
    el.innerHTML = `
      <div class="filter-row"><h2 style="margin:0">Session change</h2>
        <label class="field" style="margin:0"><span>History</span>
          <select><option>Last 10 sessions</option></select></label></div>
      ${
        latest
          ? `<div class="latest-card"><div class="note">LATEST SESSION</div>
              <strong>${latest.result}</strong>
              <p class="note">${explain(latest.result)}</p></div>`
          : ""
      }
      ${table(
        ["Date", "Trials", "Early accuracy", "Late accuracy", "Early response", "Late response", "Result"],
        rows,
        "Complete a session to compare early vs late performance."
      )}`;
  }

  _trialSlice(hist) {
    const all = this.store.data.trials;
    if (hist === "session") {
      const sid = this.store.data.sessions[0]?.id;
      return sid ? all.filter((t) => t.sessionId === sid) : all.slice(-200);
    }
    return all;
  }
}

function table(headers, rows, empty) {
  if (!rows) {
    return `<p class="note">${empty}</p>`;
  }
  return `<div class="table-wrap"><table class="data"><thead><tr>${headers
    .map((h) => `<th>${h.toUpperCase()}</th>`)
    .join("")}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

function drawSeries(ctx, pts, color) {
  if (!pts.length) return;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
  ctx.stroke();
  for (const p of pts) {
    ctx.beginPath();
    ctx.arc(p[0], p[1], 4, 0, Math.PI * 2);
    ctx.fill();
  }
}

function invert(ms, min, max) {
  return max - (ms - min);
}

function mean(xs) {
  if (!xs.length) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function median(xs) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function pct(x) {
  return `${Math.round((x || 0) * 100)}%`;
}

function fmtMs(ms) {
  return `${Math.round(ms || 0)}ms`;
}

function fmtRt(ms) {
  if (!ms) return "—";
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${Math.round(ms)}ms`;
}

function fmtDur(ms) {
  const s = Math.max(0, Math.round((ms || 0) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h) return `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

function modeName(m) {
  return m === "processing" ? "Processing Speed" : m === "divided" ? "Divided Attention" : "Selective Attention";
}

function summarize(s) {
  return `${s.responseStyle === "two-step" ? "two step" : s.responseStyle} · ${
    s.stimulusArea === "circle" ? "circle" : "full field"
  } · ${s.directionCount} dirs · ${s.peripheralTargets} target · ${s.distractors} distractors`;
}

function changeLabel(early, late) {
  const d = (late || 0) - (early || 0);
  if (d > 0.06) return "Improved";
  if (d < -0.06) return "Declined";
  return "Stable";
}

function explain(label) {
  if (label === "Improved") return "Accuracy rose from the first half of the session to the second.";
  if (label === "Declined") return "Accuracy dropped later in the session — consider a shorter block.";
  return "Performance stayed reasonably consistent from start to finish.";
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;");
}
