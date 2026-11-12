/**
 * dsh-copy-txt — browser half.
 *
 * Intercepts long plain-text pastes into the composer and turns them into a
 * .txt draft attachment (ChatGPT-style), so the input box stays readable.
 * Settings live under Settings → 长文本粘贴.
 */
window.__ModuleLoader__.load({
  id: "dsh-copy-txt",
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    const React = require("react");

    const STORAGE_KEY = "dsh-copy-txt.settings";
    const DEFAULTS = {
      enabled: true,
      minChars: 400,
      minLines: 8,
      holdShiftToPaste: true,
    };

    const SECTION_CSS = [
      ".dsh-ctx-section{display:flex;flex-direction:column;gap:4px;max-width:720px;color:var(--dsw-alias-label-primary);}",
      ".dsh-ctx-title{margin:0;font-size:16px;line-height:24px;font-weight:500;color:var(--dsw-alias-label-primary);}",
      ".dsh-ctx-intro{margin:0 0 4px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);}",
      ".dsh-ctx-row{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:16px 0;border-bottom:1px solid var(--dsw-alias-border-l2);}",
      ".dsh-ctx-row:last-child{border-bottom:none;}",
      ".dsh-ctx-rowLabel{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;padding-right:24px;}",
      ".dsh-ctx-rowTitle{font-size:14px;line-height:22px;font-weight:400;color:var(--dsw-alias-label-primary);}",
      ".dsh-ctx-caption{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);}",
      ".dsh-ctx-control{flex:none;display:flex;align-items:center;gap:10px;}",
      ".dsh-ctx-input{box-sizing:border-box;width:96px;height:32px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;font:inherit;font-size:14px;line-height:22px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);}",
      ".dsh-ctx-input:focus{outline:none;border-color:var(--dsw-alias-brand-primary);}",
      ".dsh-ctx-check{width:16px;height:16px;accent-color:var(--dsw-alias-state-business-primary);cursor:pointer;}",
      ".dsh-ctx-checkText{font-size:14px;line-height:22px;color:var(--dsw-alias-label-primary);cursor:pointer;display:inline-flex;align-items:center;gap:8px;}",
      ".dsh-ctx-toast{z-index:4000;position:fixed;left:50%;bottom:88px;transform:translateX(-50%);padding:8px 14px;border-radius:18px;background:var(--dsw-alias-button-contrast-fill, #1f1f1f);color:var(--dsw-alias-label-primary-inverted, #fff);font-size:13px;line-height:20px;box-shadow:var(--dsw-elevation-panel, 0 8px 24px rgba(0,0,0,.24));pointer-events:none;opacity:0;transition:opacity .18s ease;}",
      ".dsh-ctx-toast.show{opacity:1;}",
    ].join("\n");

    function clampInt(value, min, max, fallback) {
      const n = Number(value);
      if (!Number.isFinite(n)) return fallback;
      return Math.min(max, Math.max(min, Math.round(n)));
    }

    function normalize(input) {
      const src = input && typeof input === "object" ? input : {};
      return {
        enabled: src.enabled !== false,
        minChars: clampInt(src.minChars, 1, 100000, DEFAULTS.minChars),
        minLines: clampInt(src.minLines, 1, 10000, DEFAULTS.minLines),
        holdShiftToPaste: src.holdShiftToPaste !== false,
      };
    }

    function createStore(initial) {
      let value = initial;
      const listeners = [];
      return {
        get() { return value; },
        set(next) {
          value = next;
          for (let i = 0; i < listeners.length; i++) listeners[i]();
        },
        subscribe(listener) {
          listeners.push(listener);
          return () => {
            const at = listeners.indexOf(listener);
            if (at !== -1) listeners.splice(at, 1);
          };
        },
      };
    }

    function readLocal() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return { ...DEFAULTS };
        return normalize(JSON.parse(raw));
      } catch {
        return { ...DEFAULTS };
      }
    }

    function writeLocal(settings) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
      } catch {
        // Quota / private mode — in-memory store still works for this session.
      }
    }

    function pad(n) {
      return String(n).padStart(2, "0");
    }

    function timestamp() {
      const d = new Date();
      return [
        d.getFullYear(),
        pad(d.getMonth() + 1),
        pad(d.getDate()),
        "-",
        pad(d.getHours()),
        pad(d.getMinutes()),
        pad(d.getSeconds()),
      ].join("");
    }

    function lineCount(text) {
      if (text === "") return 0;
      let n = 1;
      for (let i = 0; i < text.length; i++) {
        if (text.charCodeAt(i) === 10) n += 1;
      }
      return n;
    }

    function shouldConvert(text, settings) {
      if (!settings.enabled) return false;
      if (typeof text !== "string" || text.length === 0) return false;
      return text.length >= settings.minChars || lineCount(text) >= settings.minLines;
    }

    function isComposerTarget(target) {
      if (!(target instanceof Node)) return false;
      const el = target instanceof Element ? target : target.parentElement;
      if (el === null) return false;
      return el.closest("[data-composer-input], [data-composer-card], [data-composer-seat]") !== null;
    }

    function clipboardHasFiles(clipboardData) {
      if (!clipboardData) return false;
      try {
        if (clipboardData.files && clipboardData.files.length > 0) return true;
      } catch {
        // Some browsers throw if files is inspected during paste.
      }
      if (clipboardData.items) {
        for (const item of clipboardData.items) {
          if (item.kind === "file") return true;
        }
      }
      const types = clipboardData.types;
      if (types && typeof types.contains === "function") {
        return types.contains("Files");
      }
      if (types && typeof types.includes === "function") {
        return types.includes("Files");
      }
      return false;
    }

    function findFileInput() {
      const card = document.querySelector("[data-composer-card]");
      if (card === null) return null;
      const input = card.querySelector('input[type="file"]');
      if (!(input instanceof HTMLInputElement) || input.disabled) return null;
      return input;
    }

    function attachFile(file) {
      const input = findFileInput();
      if (input !== null) {
        try {
          const dt = new DataTransfer();
          dt.items.add(file);
          input.files = dt.files;
          input.dispatchEvent(new Event("change", { bubbles: true }));
          return true;
        } catch (error) {
          console.warn("[dsh-copy-txt] file input inject failed", error);
        }
      }

      try {
        const dt = new DataTransfer();
        dt.items.add(file);
        const drop = new DragEvent("drop", {
          bubbles: true,
          cancelable: true,
          dataTransfer: dt,
        });
        document.dispatchEvent(drop);
        return true;
      } catch (error) {
        console.warn("[dsh-copy-txt] drop inject failed", error);
        return false;
      }
    }

    let toastEl = null;
    let toastTimer = 0;
    function showToast(message) {
      if (typeof document === "undefined") return;
      if (toastEl === null) {
        toastEl = document.createElement("div");
        toastEl.className = "dsh-ctx-toast";
        toastEl.setAttribute("role", "status");
        document.body.appendChild(toastEl);
      }
      toastEl.textContent = message;
      toastEl.classList.add("show");
      if (toastTimer) window.clearTimeout(toastTimer);
      toastTimer = window.setTimeout(() => {
        toastEl.classList.remove("show");
      }, 1800);
    }

    function makeTxtFile(text) {
      const name = `粘贴的文本 (${timestamp()}).txt`;
      return new File([text], name, {
        type: "text/plain",
        lastModified: Date.now(),
      });
    }

    function ensureCss() {
      if (typeof document === "undefined") return;
      if (document.querySelector('style[data-plugin-css="dsh-copy-txt"]')) return;
      const tag = document.createElement("style");
      tag.dataset.plugin = "dsh-copy-txt";
      tag.dataset.pluginCss = "dsh-copy-txt";
      tag.textContent = SECTION_CSS;
      document.head.appendChild(tag);
    }

    function apply(ctx) {
      ensureCss();
      const store = createStore(readLocal());

      async function loadRemote() {
        try {
          const response = await fetch("/copy-txt/settings", { credentials: "include" });
          if (!response.ok) return;
          const body = await response.json();
          if (body?.ok === true && body.settings) {
            const next = normalize(body.settings);
            writeLocal(next);
            store.set(next);
          }
        } catch {
          // Host route unavailable — localStorage already seeded the store.
        }
      }

      async function persist(next) {
        const settings = normalize(next);
        writeLocal(settings);
        store.set(settings);
        try {
          await fetch("/copy-txt/settings", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ settings }),
          });
        } catch (error) {
          console.warn("[dsh-copy-txt] persist failed", error);
        }
      }

      void loadRemote();

      ctx.effect(() => {
        const onPaste = (event) => {
          if (!(event instanceof ClipboardEvent)) return;
          if (!isComposerTarget(event.target)) return;
          const settings = store.get();
          if (!settings.enabled) return;
          if (settings.holdShiftToPaste && event.shiftKey) return;
          if (clipboardHasFiles(event.clipboardData)) return;

          const text = event.clipboardData?.getData("text/plain") ?? "";
          if (!shouldConvert(text, settings)) return;
          if (findFileInput() === null) return;

          event.preventDefault();
          event.stopImmediatePropagation();

          const file = makeTxtFile(text);
          if (attachFile(file)) {
            showToast(`已转为附件：${file.name}`);
          }
        };

        document.addEventListener("paste", onPaste, true);
        return () => {
          document.removeEventListener("paste", onPaste, true);
        };
      }, "dsh-copy-txt: paste interceptor");

      const slots = ctx.get("slots");
      if (!slots) {
        console.warn("[dsh-copy-txt] slots 服务不可用，跳过设置页注册");
        return;
      }

      slots.inject("settings.section", () => slots.register({
        name: "settings.section",
        id: "copy-txt",
        order: 36,
        label: () => "长文本粘贴",
        inject: () => ({ store, persist }),
      }, CopyTxtSection));
    }

    function el(type, props) {
      const args = [type, props];
      for (let i = 2; i < arguments.length; i++) args.push(arguments[i]);
      return React.createElement.apply(null, args);
    }

    function Row(props) {
      return el("div", { className: "dsh-ctx-row" },
        el("div", { className: "dsh-ctx-rowLabel" },
          el("div", { className: "dsh-ctx-rowTitle" }, props.title),
          props.caption
            ? el("div", { className: "dsh-ctx-caption" }, props.caption)
            : null,
        ),
        el("div", { className: "dsh-ctx-control" }, props.children),
      );
    }

    function CopyTxtSection(props) {
      const store = props.store;
      const persist = props.persist;
      const tick = React.useState(0);
      React.useEffect(() => store.subscribe(() => tick[1]((n) => n + 1)), [store]);
      const s = store.get();

      function setField(key, value) {
        persist({ ...s, [key]: value });
      }

      return el("div", { className: "dsh-ctx-section" },
        el("h2", { className: "dsh-ctx-title" }, "长文本粘贴"),
        el("p", { className: "dsh-ctx-intro" },
          "把长文本粘贴进对话框时，自动变成 txt 附件，而不是撑满输入框。达到「字符数」或「行数」任一阈值就会转换。",
        ),
        Row({
          title: "启用",
          caption: "关闭后粘贴行为与官方一致，长文本会直接进入输入框。",
          children: el("label", { className: "dsh-ctx-checkText" },
            el("input", {
              type: "checkbox",
              className: "dsh-ctx-check",
              checked: s.enabled === true,
              onChange: (e) => setField("enabled", e.target.checked),
            }),
            "启用",
          ),
        }),
        Row({
          title: "字符数阈值",
          caption: "粘贴纯文本达到该字符数时转为 txt（与行数阈值任一满足即可）。",
          children: el("input", {
            type: "number",
            min: 1,
            max: 100000,
            className: "dsh-ctx-input",
            value: String(s.minChars),
            onChange: (e) => setField("minChars", Number(e.target.value)),
          }),
        }),
        Row({
          title: "行数阈值",
          caption: "粘贴纯文本达到该行数时转为 txt（与字符数阈值任一满足即可）。",
          children: el("input", {
            type: "number",
            min: 1,
            max: 10000,
            className: "dsh-ctx-input",
            value: String(s.minLines),
            onChange: (e) => setField("minLines", Number(e.target.value)),
          }),
        }),
        Row({
          title: "按住 Shift 原样粘贴",
          caption: "Shift + 粘贴时不转换，文本仍进入输入框。适合只要一小段日志、却被阈值拦住的情况。",
          children: el("label", { className: "dsh-ctx-checkText" },
            el("input", {
              type: "checkbox",
              className: "dsh-ctx-check",
              checked: s.holdShiftToPaste === true,
              onChange: (e) => setField("holdShiftToPaste", e.target.checked),
            }),
            "启用",
          ),
        }),
      );
    }

    exports.apply = apply;
    exports.inject = ["slots"];
    return module.exports;
  },
});
