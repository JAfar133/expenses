/**
 * Copies text to the clipboard. Returns false if the browser refused (then the caller shows how to copy by hand).
 *
 * `navigator.clipboard` exists only on secure pages and may be denied; the fallback selects the text of the given
 * input and uses the old `execCommand`, which still works in Safari on iPhone (it needs `setSelectionRange`).
 */
export async function copyText(text: string, input?: HTMLInputElement | null): Promise<boolean> {
  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the old way
  }
  if (!input) return false;
  try {
    input.focus();
    input.select();
    input.setSelectionRange(0, text.length);
    return document.execCommand('copy');
  } catch {
    return false;
  }
}
