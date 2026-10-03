// Pure rules behind the shared sortable list (spec 0009, AC-13, AC-20): where an item lands, and
// what a screen reader hears at each step, worded with the item's own name.

export function moveId(
  ids: readonly string[],
  activeId: string,
  overId: string,
): readonly string[] {
  const from = ids.indexOf(activeId);
  const to = ids.indexOf(overId);
  if (from < 0 || to < 0 || from === to) return ids;
  const next = [...ids];
  next.splice(from, 1);
  next.splice(to, 0, activeId);
  return next;
}

export const sortableInstructions =
  "To move an item, focus its handle and press Space. Use the arrow keys to move it, Space to drop it, or Escape to cancel.";

export type AnnouncementText = {
  readonly start: (name: string, position: number, total: number) => string;
  readonly over: (name: string, position: number, total: number) => string;
  readonly end: (name: string, position: number, total: number) => string;
  readonly cancel: (name: string, position: number, total: number) => string;
};

export const sortableAnnouncements: AnnouncementText = {
  start: (name, position, total) => `Picked up ${name}. Position ${position} of ${total}.`,
  over: (name, position, total) => `${name} moved to position ${position} of ${total}.`,
  end: (name, position, total) => `${name} dropped at position ${position} of ${total}.`,
  cancel: (name, position, total) =>
    `Moving ${name} was cancelled. It stays at position ${position} of ${total}.`,
};
