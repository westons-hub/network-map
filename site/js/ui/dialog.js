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
    const btn = el("button", b.label, { class: `btn${b.primary ? " primary" : ""}${b.danger ? " danger" : ""}${b.cta ? " cta" : ""}`, value: b.value });
    if (b.formnovalidate || !b.primary) btn.formNoValidate = true; // only the main action checks required fields
    if (b.left) btn.classList.add("left");
    actions.append(btn);
  }
  form.append(actions);

  // Esc or a click on the dark backdrop closes the dialog, but asks first if anything was typed.
  let dirty = false;
  const markDirty = () => { dirty = true; };
  form.addEventListener("input", markDirty);
  form.addEventListener("change", markDirty);
  const confirmDiscard = () => {
    if (form.querySelector(".discard")) return;
    const bar = el("div", undefined, { class: "discard", role: "alert" });
    bar.append(el("span", "Discard changes?"),
      el("button", "Keep editing", { class: "btn small", type: "button", onclick: () => bar.remove() }),
      el("button", "Discard", { class: "btn small danger", type: "button", onclick: () => dialog.close("") }));
    actions.before(bar);
    bar.querySelector("button").focus();
  };
  const dismiss = () => (dirty ? confirmDiscard() : dialog.close(""));
  const onCancel = e => { e.preventDefault(); dismiss(); };
  const onClick = e => {
    if (e.target !== dialog) return;
    const r = dialog.getBoundingClientRect();
    const outside = e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    if (outside) dismiss();
  };
  dialog.addEventListener("cancel", onCancel);
  dialog.addEventListener("click", onClick);

  return new Promise(resolve => {
    dialog.addEventListener("close", () => {
      dialog.removeEventListener("cancel", onCancel);
      dialog.removeEventListener("click", onClick);
      resolve(dialog.returnValue);
    }, { once: true });
    dialog.returnValue = "";
    dialog.showModal();
    form.querySelector("input:not([type=hidden]), select, textarea")?.focus();
  });
}
