/** Focus a rail tab by its DOM id. Tab ids are built from `useId`, whose
 * output contains characters (`:` in React 19) that a bare `#id` selector
 * chokes on — so the lookup goes through an attribute selector with
 * `CSS.escape`. That subtlety is the whole reason this helper exists: it
 * lives once, here, instead of being re-derived at every focus hand-off. */
export function focusTab(rail: HTMLElement | null, tabId: string): void {
  rail?.querySelector<HTMLElement>(`[id="${CSS.escape(tabId)}"]`)?.focus();
}
