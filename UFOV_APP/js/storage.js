const KEY = "ufov.v1";

const empty = () => ({
  version: 1,
  sessions: [],
  checks: [],
  trials: [],
  activity: {},
  settings: null,
  bestThreshold: null,
});

export class Store {
  constructor() {
    this.data = this._load();
  }

  _load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return empty();
      const parsed = JSON.parse(raw);
      return { ...empty(), ...parsed };
    } catch {
      return empty();
    }
  }

  save() {
    localStorage.setItem(KEY, JSON.stringify(this.data));
  }

  clear() {
    this.data = empty();
    this.save();
  }

  exportJSON() {
    return JSON.stringify(this.data, null, 2);
  }

  importJSON(text) {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object") throw new Error("Invalid file");
    this.data = { ...empty(), ...parsed, version: 1 };
    this.save();
  }

  exportCSV() {
    const rows = [
      [
        "date",
        "session",
        "trial",
        "mode",
        "warmup",
        "correct",
        "centerOk",
        "targetOk",
        "flashMs",
        "dir",
        "ecc",
        "emojiMs",
        "targetMs",
        "totalMs",
      ].join(","),
    ];
    for (const t of this.data.trials) {
      rows.push(
        [
          t.at,
          t.sessionId,
          t.n,
          t.mode,
          t.warmup ? 1 : 0,
          t.correct ? 1 : 0,
          t.centerOk ? 1 : 0,
          t.targetOk ? 1 : 0,
          t.flashMs.toFixed(2),
          t.dir ?? "",
          t.ecc ?? "",
          t.emojiMs ?? "",
          t.targetMs ?? "",
          t.totalMs ?? "",
        ].join(",")
      );
    }
    return rows.join("\n");
  }

  bumpActivity(day = dayKey()) {
    this.data.activity[day] = (this.data.activity[day] || 0) + 1;
  }
}

export function dayKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function relativeTime(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  const d = Math.floor(ms / 86400000);
  if (d <= 0) {
    const h = Math.floor(ms / 3600000);
    if (h <= 0) return "just now";
    return `${h}h ago`;
  }
  return `${d}d ago`;
}

export function download(filename, text, type = "text/plain") {
  const blob = new Blob([text], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
}

export function pillClass(pct) {
  if (pct >= 80) return "ok";
  if (pct >= 50) return "warn";
  return "bad";
}
