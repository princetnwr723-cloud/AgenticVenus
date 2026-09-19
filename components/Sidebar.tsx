"use client";

import type { Provider } from "@/lib/providers";
import type { ChatSummary } from "@/lib/chats";
import type { ChatGroup } from "@/lib/chatGroups";

type Props = {
  userLabel: string;
  connected: Provider | null;
  onNewChat: () => void;
  onSwitchModel: () => void;
  onOpenScheduler: () => void;
  onOpenPlugins: () => void;
  onOpenMCP: () => void;
  onOpenBusinessDNA: () => void;
  onOpenSkills: () => void;
  onOpenPricing: () => void;
  onOpenConnections: () => void;
  onLogout: () => void;
  chats: ChatSummary[];
  groups: ChatGroup[];
  activeChatId: string | null;
  activeGroupId: string | null;
  onSelectChat: (chatId: string) => void;
  onSelectGroup: (groupId: string) => void;
};

export default function Sidebar({
  userLabel,
  connected,
  onNewChat,
  onSwitchModel,
  onOpenScheduler,
  onOpenPlugins,
  onOpenMCP,
  onOpenBusinessDNA,
  onOpenSkills,
  onOpenPricing,
  onOpenConnections,
  onLogout,
  chats,
  groups,
  activeChatId,
  activeGroupId,
  onSelectChat,
  onSelectGroup,
}: Props) {
  const visibleChats = chats.filter((c) => !c.mergedGroupId);

  return (
    <aside className="flex h-screen w-64 shrink-0 flex-col border-r border-black/5 bg-cream-dark/60">
      <div className="flex items-center gap-2 px-4 py-4">
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-clay text-sm font-semibold text-cream">V</span>
        <span className="text-base font-medium">AgenticVenus</span>
      </div>

      <div className="px-3">
        <button
          onClick={onNewChat}
          className="focus-ring flex w-full items-center gap-2 rounded-md border border-ink/10 bg-white px-3 py-2.5 text-sm font-medium text-ink transition-all hover:-translate-y-0.5 hover:bg-sand hover:shadow-sm"
        >
          <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
            <path d="M7.5 2v11M2 7.5h11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
          New chat
        </button>
      </div>

      <div className="mt-4 space-y-0.5 px-3">
        <NavItem icon={<SchedulerIcon />} label="Scheduler" onClick={onOpenScheduler} />
        <NavItem icon={<PluginIcon />} label="Plugins" onClick={onOpenPlugins} />
        <NavItem icon={<MCPIcon />} label="MCP Tools" onClick={onOpenMCP} />
        <NavItem icon={<SkillIcon />} label="Skills" onClick={onOpenSkills} />
        <NavItem icon={<ConnectionIcon />} label="Connections" onClick={onOpenConnections} />
        <NavItem icon={<BusinessIcon />} label="Business DNA" onClick={onOpenBusinessDNA} />
        <NavItem icon={<PlanIcon />} label="Plans" onClick={onOpenPricing} />
        <NavItem icon={<MissionIcon />} label="Missions" onClick={onOpenMissions} />
      </div>

      {groups.length > 0 && (
        <div className="mt-5 px-3">
          <p className="px-2 text-xs font-medium uppercase tracking-wide text-ink/35">Groups</p>
          <div className="mt-2 space-y-0.5">
            {groups.map((g) => (
              <button
                key={g.id}
                onClick={() => onSelectGroup(g.id)}
                className={`block w-full truncate rounded-md px-3 py-2 text-left text-sm transition-colors ${
                  activeGroupId === g.id ? "bg-sand text-ink" : "text-ink/70 hover:bg-sand/60 hover:text-ink"
                }`}
              >
                👥 {g.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="mt-5 flex-1 overflow-y-auto px-3">
        <p className="px-2 text-xs font-medium uppercase tracking-wide text-ink/35">Chats</p>
        <div className="mt-2 space-y-0.5">
          {visibleChats.length === 0 ? (
            <p className="px-2 py-2 text-sm text-ink/40">Your conversations will show up here.</p>
          ) : (
            visibleChats.map((chat) => (
              <button
                key={chat.id}
                onClick={() => onSelectChat(chat.id)}
                className={`block w-full truncate rounded-md px-3 py-2 text-left text-sm transition-colors ${
                  activeChatId === chat.id && !activeGroupId ? "bg-sand text-ink" : "text-ink/70 hover:bg-sand/60 hover:text-ink"
                }`}
              >
                {chat.title}
              </button>
            ))
          )}
        </div>
      </div>

      <div className="border-t border-black/5 px-3 py-4">
        <button
          onClick={onSwitchModel}
          className="focus-ring flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-sm transition-colors hover:bg-sand"
        >
          <span className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: connected?.accent ?? "#00000022" }} />
            <span className="text-ink/75">{connected ? connected.name : "No provider connected"}</span>
          </span>
          <span className="text-xs text-clay">Switch</span>
        </button>

        <div className="mt-3 flex items-center justify-between px-2">
          <span className="truncate text-xs text-ink/45">{userLabel}</span>
          <button onClick={onLogout} className="focus-ring shrink-0 text-xs text-ink/50 transition-colors hover:text-ink">
            Log out
          </button>
        </div>
      </div>
    </aside>
  );
}

function NavItem({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="focus-ring flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-sm text-ink/70 transition-colors hover:bg-sand hover:text-ink"
    >
      <span className="text-ink/50">{icon}</span>
      {label}
    </button>
  );
}

function SchedulerIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
      <rect x="2" y="3" width="11" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M2 6h11M5 2v2M10 2v2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}
function PluginIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
      <path d="M5 3v2M10 3v2M3 6h9v3a4.5 4.5 0 01-9 0V6z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M7.5 12.5V14" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}
function MCPIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
      <circle cx="4" cy="4" r="2" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="11" cy="11" r="2" stroke="currentColor" strokeWidth="1.2" />
      <path d="M5.5 5.5L9.5 9.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}
function ConnectionIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
      <circle cx="3.5" cy="7.5" r="2" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="11.5" cy="7.5" r="2" stroke="currentColor" strokeWidth="1.2" />
      <path d="M5.5 7.5h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}
function BusinessIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
      <rect x="3" y="6" width="9" height="6.5" rx="1" stroke="currentColor" strokeWidth="1.2" />
      <path d="M5.5 6V4a2 2 0 012-2h0a2 2 0 012 2v2" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}
function SkillIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
      <path d="M7.5 2l1.5 3 3.3.5-2.4 2.3.6 3.3-2.9-1.6-2.9 1.6.6-3.3-2.4-2.3 3.3-.5z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
    </svg>
  );
}
function PlanIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
      <rect x="2" y="3" width="11" height="9" rx="1.2" stroke="currentColor" strokeWidth="1.2" />
      <path d="M2 6h11" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}