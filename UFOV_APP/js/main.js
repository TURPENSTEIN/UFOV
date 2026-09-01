console.log("%c UFOV Engine | Developed by TURPENSTEIN ", "background: #14161b; color: #3b82f6; font-size: 12px; font-weight: bold; padding: 4px 8px; border-radius: 4px;");
import { UfovEngine } from "./engine.js";
import { Store } from "./storage.js";
import { Analytics } from "./analytics.js";
import { UI } from "./ui.js";

const store = new Store();
const analytics = new Analytics(store);
const canvas = document.getElementById("stage");

let ui;
const engine = new UfovEngine(canvas, (type, payload) => ui?.onEngine(type, payload));
ui = new UI({ engine, analytics, store });
ui.mount();

window.addEventListener("beforeunload", () => {
  if (engine.running) engine.stopSession("unload");
  engine.destroy();
});
