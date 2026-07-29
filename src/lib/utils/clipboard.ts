/**
 * Clipboard write with a fallback for non-secure contexts.
 *
 * `navigator.clipboard` is undefined on any origin that isn't HTTPS or
 * localhost — which includes the common self-hosted case of reaching this app
 * over plain HTTP on a LAN address. Calling it there threw a TypeError out of
 * the click handler and the copy button silently did nothing.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }

  try {
    const el = document.createElement('textarea');
    el.value = text;
    // Keep it out of view and out of the layout, but still selectable.
    el.setAttribute('readonly', '');
    el.style.position = 'fixed';
    el.style.top = '-1000px';
    el.style.opacity = '0';
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand('copy');
    el.remove();
    return ok;
  } catch {
    return false;
  }
}
