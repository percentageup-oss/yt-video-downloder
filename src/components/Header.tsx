import { RefreshCw } from 'lucide-react';
import type { FilterTab } from '../types.ts';

interface HeaderProps {
  activeTab: FilterTab;
  onSelectTab: (tab: FilterTab) => void;
  updatingYtDlp: boolean;
  onUpdateYtDlp: () => void;
}

const NAV_TABS: { id: FilterTab; label: string }[] = [
  { id: 'all', label: 'All Queue' },
  { id: 'active', label: 'Active' },
  { id: 'paused', label: 'Paused' },
  { id: 'done', label: 'Completed' },
  { id: 'setup', label: 'Setup Guide' },
];

export function Header({
  activeTab,
  onSelectTab,
  updatingYtDlp,
  onUpdateYtDlp,
}: HeaderProps) {
  return (
    <header className="border-b border-white/[0.08] bg-[#0B0F17]/95 backdrop-blur-sm sticky top-0 z-20">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-8 px-4 py-3.5 sm:px-6">
        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            onSelectTab('all');
          }}
          className="text-lg font-bold tracking-tight text-white whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
        >
          ResumeDL
        </a>

        <nav
          aria-label="Queue filters"
          className="hidden md:flex items-center gap-6 text-sm font-medium"
        >
          {NAV_TABS.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => onSelectTab(tab.id)}
                className={`py-1.5 border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded-t ${
                  isActive
                    ? 'border-blue-500 text-white'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </nav>

        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={onUpdateYtDlp}
            disabled={updatingYtDlp}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-500 disabled:opacity-60 disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0 min-h-[40px] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${updatingYtDlp ? 'animate-spin' : ''}`} />
            <span>{updatingYtDlp ? 'Updating...' : 'Update yt-dlp'}</span>
          </button>
        </div>
      </div>
    </header>
  );
}
