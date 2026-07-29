import { TABS, type TabId } from '../types';

interface TabBarProps {
  active: TabId;
  onSelect: (id: TabId) => void;
}

export function TabBar({ active, onSelect }: TabBarProps) {
  return (
    <nav class="tabbar" aria-label="Primary">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          class="tabbar__btn"
          aria-current={tab.id === active ? 'page' : undefined}
          onClick={() => onSelect(tab.id)}
        >
          <span class="tabbar__dot" aria-hidden="true" />
          {tab.label}
        </button>
      ))}
    </nav>
  );
}
