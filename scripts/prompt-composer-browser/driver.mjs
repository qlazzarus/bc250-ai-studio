// Minimal CDP driver for the prompt-composer browser verification. Node's built-in
// WebSocket keeps this dependency-free, so no package is added to the repository.
// Copied from the U11 harness (2026-11-16) and extended with keyboard helpers.
import { writeFileSync, mkdirSync } from "node:fs";

export function connectBrowser(wsUrl) {
  const ws = new WebSocket(wsUrl);
  const pending = new Map();
  const listeners = new Set();
  let id = 0;
  const ready = new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error("websocket failed"));
  });
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.method) {
      for (const listener of listeners) listener(msg);
      // Dialogs block every later CDP call; accept them unless a listener opts out.
      if (msg.method === "Page.javascriptDialogOpening") {
        const sessionId = msg.sessionId;
        raw(sessionId ? { sessionId, method: "Page.handleJavaScriptDialog", params: { accept: true } }
          : { method: "Page.handleJavaScriptDialog", params: { accept: true } }).catch(() => {});
      }
    }
    const entry = msg.id ? pending.get(msg.id) : null;
    if (!entry) return;
    pending.delete(msg.id);
    msg.error ? entry.reject(new Error(msg.error.message)) : entry.resolve(msg.result ?? {});
  };
  ws.onclose = () => {
    for (const entry of pending.values()) entry.reject(new Error("websocket closed"));
    pending.clear();
  };
  const raw = (payload) => new Promise((resolve, reject) => {
    const messageId = ++id;
    pending.set(messageId, { resolve, reject });
    ws.send(JSON.stringify({ ...payload, id: messageId }));
    setTimeout(() => {
      if (pending.has(messageId)) { pending.delete(messageId); reject(new Error(`timeout ${payload.method}`)); }
    }, 25000);
  });
  const send = (method, params = {}) => raw({ method, params });
  const sendTo = (sessionId, method, params = {}) => raw({ sessionId, method, params });
  return { ready, send, sendTo, on: (listener) => listeners.add(listener), close: () => ws.close() };
}

export function pageClient(sendTo, sessionId) {
  const call = (method, params) => sendTo(sessionId, method, params);
  const evaluate = async (expression) => {
    const result = await call("Runtime.evaluate", {
      expression, returnByValue: true, awaitPromise: true, userGesture: true,
    });
    if (result.exceptionDetails) {
      throw new Error(`eval failed: ${result.exceptionDetails.exception?.description ?? JSON.stringify(result.exceptionDetails).slice(0, 600)}`);
    }
    return result.result?.value;
  };
  const waitFor = async (expression, { timeout = 15000, label = "" } = {}) => {
    const deadline = Date.now() + timeout;
    let last;
    while (Date.now() < deadline) {
      try {
        last = await evaluate(expression);
        if (last) return last;
      } catch (error) { last = error.message; }
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    throw new Error(`timeout ${label || expression}: ${last}`);
  };
  const shot = async (dir, name) => {
    mkdirSync(dir, { recursive: true });
    const { data } = await call("Page.captureScreenshot", { format: "png" });
    const path = `${dir}/${name}`;
    writeFileSync(path, Buffer.from(data, "base64"));
    return path;
  };
  const click = (selector, index = 0) => evaluate(`(() => {
    const nodes = [...document.querySelectorAll(${JSON.stringify(selector)})];
    const node = nodes[${index}];
    if (!node) return false;
    node.scrollIntoView({ block: "center" });
    node.click();
    return true;
  })()`);
  const clickByText = (selector, text) => evaluate(`(() => {
    const node = [...document.querySelectorAll(${JSON.stringify(selector)})]
      .find((item) => (item.textContent || "").includes(${JSON.stringify(text)}));
    if (!node) return false;
    node.scrollIntoView({ block: "center" });
    node.click();
    return true;
  })()`);
  const typeInto = (selector, value) => evaluate(`(() => {
    const node = document.querySelector(${JSON.stringify(selector)});
    if (!node) return false;
    const proto = Object.getPrototypeOf(node);
    Object.getOwnPropertyDescriptor(proto, "value").set.call(node, ${JSON.stringify(value)});
    node.dispatchEvent(new Event("input", { bubbles: true }));
    return node.value;
  })()`);
  const select = (selector, value) => evaluate(`(() => {
    const node = document.querySelector(${JSON.stringify(selector)});
    if (!node) return false;
    const proto = Object.getPrototypeOf(node);
    Object.getOwnPropertyDescriptor(proto, "value").set.call(node, ${JSON.stringify(value)});
    node.dispatchEvent(new Event("change", { bubbles: true }));
    return node.value;
  })()`);
  const press = async (key, code, keyCode, modifiers = 0) => {
    // One keydown, one keyup. A `char` event in addition to keydown double-fires
    // button activation (Enter), which silently removed every chip in the harness.
    // Enter needs a carriage return in `text` for Chromium to synthesize the click.
    const text = key === "Enter" ? "\r" : key.length === 1 ? key : undefined;
    const params = { key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode, modifiers };
    await call("Input.dispatchKeyEvent", { type: text === undefined ? "rawKeyDown" : "keyDown", ...params, text });
    await call("Input.dispatchKeyEvent", { type: "keyUp", ...params });
  };
  // Real Tab traversal instead of .focus(): the U10 suite only proved that a node
  // could be focused, not that the keyboard order reaches it.
  const tab = (shift = false) => press("Tab", "Tab", 9, shift ? 8 : 0);
  const isActive = (selector) => evaluate(`(() => {
    const node = document.querySelector(${JSON.stringify(selector)});
    return !!node && document.activeElement === node;
  })()`);
  const activeInfo = () => evaluate(`(() => {
    const node = document.activeElement;
    if (!node) return null;
    return { tag: node.tagName, id: node.id || null, className: node.className || null,
      label: node.getAttribute ? node.getAttribute("aria-label") : null,
      text: (node.textContent || "").trim().slice(0, 40) };
  })()`);
  const viewport = (width, height, mobile = false) => call("Emulation.setDeviceMetricsOverride", {
    width, height, deviceScaleFactor: 1, mobile,
  });
  return { call, evaluate, waitFor, shot, click, clickByText, typeInto, select, press, tab, isActive,
    activeInfo, viewport };
}
