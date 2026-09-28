// A small modal dialog and a toast, shared by the app and its forms.

import { el } from "./dom.js";

let toastTimer;
export function toast(message, ms = 4500) {
  const t = document.getElementById("toast");
  t.textContent = message;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

/**
 * Show a modal. `body` is a Node or text; buttons: [{ label, value, primary, danger, formnovalidate }].
 * Resolves with the clicked button's value ("" if closed with Esc).
 */
export function ask(title, body, buttons) {
  const dialog = document.getElementById("dialog");
  const form = document.getElementById("dialog-body");
  form.replaceChildren(el("h3", title));
  if (body instanceof Node) form.append(body); else if (body) form.append(el("p", body));
  const actions = el("div", undefined, { class: "actions" });
  for (const b of buttons) {
    const btn = el("button", b.label, { class: `btn${b.primary ? " primary" : ""}${b.danger ? " danger" : ""}`, value: b.value });
    if (b.formnovalidate || !b.primary) btn.formNoValidate = true; // only the main action checks required fields
    if (b.left) btn.classList.add("left");
    actions.append(btn);
  }
  form.append(actions);
  return new Promise(resolve => {
    dialog.addEventListener("close", () => resolve(dialog.returnValue), { once: true });
    dialog.returnValue = "";
    dialog.showModal();
    form.querySelector("input:not([type=hidden]), select, textarea")?.focus();
  });
}
