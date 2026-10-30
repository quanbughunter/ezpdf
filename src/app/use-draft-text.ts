import { useState } from 'react';

/**
 * Text a person types over a value that lives elsewhere (font size, page
 * number): shows `value` until they type, then their text until `reset()`
 * (on Enter or when the box loses focus).
 *
 * Worked out while rendering, not copied over in an effect: an effect's copy
 * lands one task later, and if that is after the person (or a test) has
 * selected the box's text, it replaces the text, drops the selection, and what
 * they type is added to the old number ("14" + "16" → 1416). A new `value`
 * also never overwrites what they are in the middle of typing.
 */
export function useDraftText(value: string) {
  const [draft, setDraft] = useState<string | null>(null);
  return { text: draft ?? value, setText: setDraft, reset: () => setDraft(null) };
}
