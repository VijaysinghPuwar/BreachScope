/** Remembers that this browser has seen the first-visit guide. */
const STORAGE_KEY = 'breachscope.guide.v1';

export function guideSeen(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'done';
  } catch {
    // Private windows can block storage. Show the guide; it is dismissable.
    return false;
  }
}

export function markGuideSeen() {
  try {
    window.localStorage.setItem(STORAGE_KEY, 'done');
  } catch {
    // Nothing to do: the guide simply shows again next visit.
  }
}
