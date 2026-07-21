import { Settings } from 'lucide-react';
import type { SettingsSection } from '../../settings/SettingsModal';

export function SidebarFooter({ onOpen }: { onOpen: (section: SettingsSection) => void }) {
  return (
    <div className="sidebar-footer" aria-label="Application tools">
      <button title="Settings" aria-label="Settings" onClick={() => onOpen('general')}><Settings size={14} /></button>
    </div>
  );
}
