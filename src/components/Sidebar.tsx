"use client";

type SidebarProps = {
  active: string;
  onChange: (s: string) => void;
};

const ICONS: Array<{ id: string; label: string; path: string }> = [
  {
    id: "Command Center",
    label: "Command",
    path: "M13 10V3L4 14h7v7l9-11h-7z",
  },
  {
    id: "Market Intelligence",
    label: "Market",
    path: "M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z",
  },
  {
    id: "Player Universe",
    label: "Players",
    path: "M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z",
  },
  {
    id: "Narrative Engine",
    label: "Narrative",
    path: "M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
  },
  {
    id: "Nexus Simulator",
    label: "Nexus",
    path: "M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2v-4M9 21H5a2 2 0 01-2-2v-4m0 0h18",
  },
  {
    id: "Settings",
    label: "Settings",
    path: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z",
  },
];

export function Sidebar({ active, onChange }: SidebarProps) {
  return (
    <aside className="rae-sidebar" aria-label="Primary navigation">
      <div className="sidebar-brand">
        <span>R</span>
      </div>
      <nav className="sidebar-nav">
        {ICONS.map((icon) => (
          <button
            key={icon.id}
            className={`sidebar-icon${active === icon.id ? " active" : ""}`}
            onClick={() => onChange(icon.id)}
            aria-label={icon.label}
            title={icon.label}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              width="20"
              height="20"
              aria-hidden="true"
            >
              <path d={icon.path} />
            </svg>
            <span className="sidebar-label">{icon.label}</span>
          </button>
        ))}
      </nav>
    </aside>
  );
}
