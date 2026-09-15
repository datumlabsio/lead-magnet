/**
 * Lead magnet form bridge.
 *
 * Drop one line into a handed-over landing page and its form starts working:
 *
 *   <script src="/lm.js" data-magnet="your-slug" defer></script>
 *
 * The only thing the form itself must have is an email input named "email".
 * Everything else — the honeypot, the timing signal, UTM capture, the loading
 * and error states — is added here so nobody has to remember it.
 */
(() => {
  const script = document.currentScript;
  const defaultMagnet = script?.getAttribute("data-magnet") ?? null;
  const endpoint = script?.getAttribute("data-endpoint") ?? "/api/lead";
  const loadedAt = Date.now();

  const UTM_KEYS = [
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_term",
    "utm_content",
    "gclid",
    "fbclid",
    "ref",
  ];

  /** UTM params are read once at load: a later redirect would otherwise lose them. */
  function captureUtm() {
    const params = new URLSearchParams(window.location.search);
    const utm = {};
    for (const key of UTM_KEYS) {
      const value = params.get(key);
      if (value) utm[key] = value;
    }
    return utm;
  }

  const utm = captureUtm();

  /**
   * A bot fills every input it can find. This one is off-screen rather than
   * `display:none`, which the better bots check for.
   */
  function addHoneypot(form) {
    if (form.querySelector('input[name="_hp"]')) return;
    const wrap = document.createElement("div");
    wrap.setAttribute("aria-hidden", "true");
    wrap.style.cssText =
      "position:absolute;left:-9999px;top:auto;width:1px;height:1px;overflow:hidden;";
    const input = document.createElement("input");
    input.type = "text";
    input.name = "_hp";
    input.tabIndex = -1;
    input.autocomplete = "off";
    wrap.appendChild(input);
    form.appendChild(wrap);
  }

  /**
   * Uses an element the designer marked with `data-lm-message` when there is
   * one, so their styling wins. Otherwise appends a plain one.
   */
  function messageTarget(form) {
    const existing = form.querySelector("[data-lm-message]");
    if (existing) return existing;
    const created = document.createElement("div");
    created.setAttribute("data-lm-message", "");
    created.setAttribute("data-lm-created", "");
    created.setAttribute("role", "status");
    created.style.cssText = "margin-top:12px;font-size:14px;";
    form.appendChild(created);
    return created;
  }

  /**
   * Sets `data-lm-state` so a designer can style success and error themselves.
   * The fallback colour is only applied to an element we created — if they
   * marked their own `[data-lm-message]`, their CSS is left to win.
   */
  function showMessage(form, text, isError) {
    const target = messageTarget(form);
    target.textContent = text;
    target.setAttribute("data-lm-state", isError ? "error" : "success");
    if (target.hasAttribute("data-lm-created")) {
      target.style.color = isError ? "#b42318" : "#027a48";
    }
  }

  function submitButton(form) {
    return form.querySelector('button[type="submit"], input[type="submit"], button:not([type])');
  }

  function setBusy(form, busy) {
    const button = submitButton(form);
    if (!button) return;
    if (busy) {
      button.dataset.lmLabel = button.tagName === "INPUT" ? button.value : button.innerHTML;
      button.disabled = true;
      const waiting = form.getAttribute("data-lm-sending") || "Sending…";
      if (button.tagName === "INPUT") button.value = waiting;
      else button.textContent = waiting;
      return;
    }
    button.disabled = false;
    const previous = button.dataset.lmLabel;
    if (previous !== undefined) {
      if (button.tagName === "INPUT") button.value = previous;
      else button.innerHTML = previous;
      delete button.dataset.lmLabel;
    }
  }

  function collect(form) {
    const data = {};
    for (const [key, value] of new FormData(form).entries()) {
      if (typeof value === "string") data[key] = value;
    }
    return data;
  }

  async function handleSubmit(event) {
    const form = event.currentTarget;
    const magnet = form.getAttribute("data-magnet") || defaultMagnet;
    if (!magnet) return; // Not ours to handle — let the form submit normally.

    event.preventDefault();
    if (form.dataset.lmBusy === "1") return;
    form.dataset.lmBusy = "1";
    setBusy(form, true);

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          magnet,
          data: collect(form),
          utm,
          elapsedMs: Date.now() - loadedAt,
        }),
      });

      const result = await response.json().catch(() => ({}));

      if (response.ok && result.ok) {
        if (result.redirect) {
          window.location.assign(result.redirect);
          return; // Stay busy through the navigation.
        }
        form.dataset.lmDone = "1";
        showMessage(form, result.message || "Check your inbox.", false);
        const fields = form.querySelector("[data-lm-fields]");
        if (fields) fields.hidden = true;
        else setBusy(form, true);
        return;
      }

      showMessage(form, result.message || "Something went wrong. Please try again.", true);
      setBusy(form, false);
    } catch (cause) {
      console.error("Lead submission failed", cause);
      showMessage(form, "Network error. Please check your connection and try again.", true);
      setBusy(form, false);
    } finally {
      delete form.dataset.lmBusy;
    }
  }

  // Native validation is left switched on: the browser runs it before the
  // submit event fires, so a designer's `required` and `type="email"` still work
  // and we never see an invalid submission.
  function wire() {
    const forms = document.querySelectorAll(defaultMagnet ? "form" : "form[data-magnet]");
    for (const form of forms) {
      if (form.dataset.lmWired === "1") continue;
      if (form.hasAttribute("data-lm-ignore")) continue;
      form.dataset.lmWired = "1";
      addHoneypot(form);
      form.addEventListener("submit", handleSubmit);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wire);
  } else {
    wire();
  }
})();
