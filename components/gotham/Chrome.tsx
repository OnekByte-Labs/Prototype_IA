"use client";

import { Modal } from "@/components/ds";

/** Keyboard shortcut reference, opened from the title bar. */
const SHORTCUTS: [string, string][] = [
  ["/", "Focus search"],
  ["j / k", "Move down / up the alert rows"],
  ["a", "Acknowledge the selected alert"],
  ["x", "Select / deselect the focused row"],
  ["Esc", "Close panel, popover or selection"],
  ["?", "This help"],
];

export function ShortcutHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Keyboard shortcuts" size="sm" testId="shortcuts">
      <ul className="flex flex-col">
        {SHORTCUTS.map(([k, d]) => (
          <li key={k} className="flex items-center justify-between h-9 border-b border-line last:border-0">
            <span className="text-ui text-ink-2">{d}</span>
            <kbd className="text-data font-data text-ink bg-canvas border border-line-strong shadow-key-sm rounded-sm px-1.5 min-w-6 text-center">
              {k}
            </kbd>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
