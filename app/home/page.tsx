"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useAuth } from "@/components/AuthProvider";
import ModelSelectorModal from "@/components/ModelSelectorModal";
import Sidebar from "@/components/Sidebar";
import { ChatMessageItem, TypingIndicator } from "@/components/ChatMessage";
import SchedulerPanel from "@/components/SchedulerPanel";
import PluginsPanel from "@/components/PluginsPanel";
import MCPPanel from "@/components/MCPPanel";
import BusinessDNAPanel from "@/components/BusinessDNAPanel";
import AgentTeamPanel from "@/components/AgentTeamPanel";
import CodespacePanel from "@/components/CodespacePanel";
import ModelDropdown from "@/components/ModelDropdown";
import SettingsPanel from "@/components/SettingsPanel";
import ToolConnectPrompt from "@/components/ToolConnectPrompt";
import {
  getPrimaryConnection,
  getAllConnections,
  updateConnectionModel,
  type SavedConnection,
} from "@/lib/connections";
import { sendChatMessage, type ChatMessage } from "@/lib/chatClient";
import type { Provider } from "@/lib/providers";
import { classifyAgent, getAgentById, type Agent } from "@/lib/agents";
import {
  getBusinessDNA,
  buildBusinessContext,
  generateGreeting,
  type BusinessDNA,
} from "@/lib/businessDNA";
import { runDueTasks, addScheduledTask, nextOccurrence } from "@/lib/scheduler";
import { detectScheduleIntent } from "@/lib/scheduleDetect";
import { detectToolNeed, type ToolNeed } from "@/lib/toolDetect";
import { listConnectedPluginIds, connectedToolNames, effectiveConnectedToolIds } from "@/lib/pluginConnections";
import { listMCPServers, type MCPServer } from "@/lib/mcp";
import { decideMcpToolCall, callMcpTool } from "@/lib/mcpOrchestrator";
import { decidePluginAction, callPluginAction } from "@/lib/pluginOrchestrator";
import { extractCodeFiles } from "@/lib/codeExtract";
import {
  listChats,
  createChat,
  getChat,
  saveChatMessages,
  type ChatSummary,
  type ChatRecord,
} from "@/lib/chats";

export default function HomePage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  const [checkingConnection, setCheckingConnection] = useState(true);
  const [connected, setConnected] = useState<Provider | null>(null); // sidebar default
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [connections, setConnections] = useState<SavedConnection[]>([]);
  const [activeProviderId, setActiveProviderId] = useState<string | null>(null);
  const [businessDNA, setBusinessDNA] = useState<BusinessDNA | null>(null);
  const [connectedToolIds, setConnectedToolIds] = useState<string[]>([]);
  const [mcpServers, setMcpServers] = useState<MCPServer[]>([]);
  const [usingMcpTool, setUsingMcpTool] = useState<string | null>(null);
  const [usingPluginAction, setUsingPluginAction] = useState<string | null>(null);
  const [mcpBanner, setMcpBanner] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [forceSelect, setForceSelect] = useState(false);

  // Feature panels
  const [schedulerOpen, setSchedulerOpen] = useState(false);
  const [pluginsOpen, setPluginsOpen] = useState(false);
  const [highlightToolId, setHighlightToolId] = useState<string | null>(null);
  const [mcpOpen, setMcpOpen] = useState(false);
  const [mcpPrefill, setMcpPrefill] = useState<{ name: string; url: string } | null>(null);
  const [businessOpen, setBusinessOpen] = useState(false);
  const [codespaceOpen, setCodespaceOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Agent Team
  const [activeAgent, setActiveAgent] = useState<Agent | null>(null);
  const [classifying, setClassifying] = useState(false);

  // Tool awareness — a pending prompt to connect a needed tool
  const [toolNeed, setToolNeed] = useState<ToolNeed | null>(null);

  // Chat persistence
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [chatId, setChatId] = useState<string | null>(null);
  const [telegram, setTelegram] = useState<ChatRecord["telegram"]>(null);

  // Personalized greeting
  const [greeting, setGreeting] = useState<string | null>(null);
  const [generatingGreeting, setGeneratingGreeting] = useState(false);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);

  const activeConnection: SavedConnection | null =
    connections.find((c) => c.provider.id === activeProviderId) ??
    (connected && apiKey ? { provider: connected, apiKey } : null);

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
    }
  }, [loading, user, router]);

  async function refreshChats() {
    if (!user) return;
    setChats(await listChats(user.uid));
  }

  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const [existing, allConns, dna, toolIds, servers] = await Promise.all([
          getPrimaryConnection(user.uid),
          getAllConnections(user.uid),
          getBusinessDNA(user.uid),
          listConnectedPluginIds(user.uid),
          listMCPServers(user.uid),
        ]);
        setConnections(allConns);
        if (existing) {
          setConnected(existing.provider);
          setApiKey(existing.apiKey);
          setActiveProviderId(existing.provider.id);
        } else {
          setForceSelect(true);
          setModalOpen(true);
        }
        setBusinessDNA(dna);
        setConnectedToolIds(toolIds);
        setMcpServers(servers);
        await refreshChats();
      } catch (err) {
        console.error("[home] failed to load workspace data:", err);
        setForceSelect(true);
        setModalOpen(true);
      } finally {
        setCheckingConnection(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  useEffect(() => {
    const draft = sessionStorage.getItem("agenticvenus_draft");
    if (draft) {
      setInput(draft);
      sessionStorage.removeItem("agenticvenus_draft");
    }
  }, []);

  // After redirecting back from an MCP server's OAuth login, show what
  // happened and refresh the connected-servers list.
  useEffect(() => {
    if (!user) return;
    const params = new URLSearchParams(window.location.search);
    const mcpConnected = params.get("mcpConnected");
    const mcpError = params.get("mcpError");
    const pluginConnected = params.get("pluginConnected");
    const pluginError = params.get("pluginError");
    if (!mcpConnected && !mcpError && !pluginConnected && !pluginError) return;

    if (mcpConnected) {
      setMcpBanner({ type: "success", text: `Connected to ${mcpConnected}.` });
      setMcpOpen(true);
      listMCPServers(user.uid).then(setMcpServers);
    } else if (mcpError) {
      setMcpBanner({ type: "error", text: mcpError });
      setMcpOpen(true);
    } else if (pluginConnected) {
      setMcpBanner({ type: "success", text: `Connected to ${pluginConnected}.` });
      setPluginsOpen(true);
      listConnectedPluginIds(user.uid).then(setConnectedToolIds);
    } else if (pluginError) {
      setMcpBanner({ type: "error", text: pluginError });
      setPluginsOpen(true);
    }
    window.history.replaceState({}, "", "/home");
    const timer = setTimeout(() => setMcpBanner(null), 6000);
    return () => clearTimeout(timer);
  }, [user]);

  useEffect(() => {
    if (!user || !connected || !apiKey) return;
    const defaultModel = connections.find((c) => c.provider.id === connected.id)?.model;

    const run = async () => {
      const affectedChatIds = await runDueTasks(user.uid, connected.id, apiKey, defaultModel);
      if (affectedChatIds.length) {
        await refreshChats();
        if (chatId && affectedChatIds.includes(chatId)) {
          const chat = await getChat(user.uid, chatId);
          if (chat) setMessages(chat.messages);
        }
      }
    };

    run();
    const interval = setInterval(run, 60_000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, connected, apiKey, connections, chatId]);

  useEffect(() => {
    if (!activeConnection || !businessDNA || messages.length > 0) return;
    if (greeting || generatingGreeting) return;
    setGeneratingGreeting(true);
    generateGreeting(
      activeConnection.provider.id,
      activeConnection.apiKey,
      businessDNA,
      activeConnection.model
    ).then((g) => {
      setGreeting(g);
      setGeneratingGreeting(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConnection?.provider.id, businessDNA, messages.length, chatId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, sending]);

  useEffect(() => {
    if (!user || !chatId || !telegram?.botUsername) return;
    const interval = setInterval(async () => {
      const chat = await getChat(user.uid, chatId);
      if (chat && chat.messages.length !== messages.length) {
        setMessages(chat.messages);
      }
    }, 4000);
    return () => clearInterval(interval);
  }, [user, chatId, telegram?.botUsername, messages.length]);

  if (loading || !user || checkingConnection) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-cream">
        <p className="animate-fade-in text-sm text-ink/50">Loading your workspace...</p>
      </main>
    );
  }

  function handleConnected(provider: Provider, key: string) {
    setConnections((prev) => {
      const others = prev.filter((c) => c.provider.id !== provider.id);
      return [...others, { provider, apiKey: key }];
    });
    if (!connected) {
      setConnected(provider);
      setApiKey(key);
    }
    setActiveProviderId(provider.id);
    setForceSelect(false);
  }

  function handleNewChat() {
    setMessages([]);
    setError(null);
    setInput("");
    setActiveAgent(null);
    setChatId(null);
    setGreeting(null);
    setTelegram(null);
    setToolNeed(null);
    setActiveProviderId(connected?.id ?? null);
  }

  async function handleSelectChat(id: string) {
    if (!user) return;
    const chat = await getChat(user.uid, id);
    if (!chat) return;
    setChatId(chat.id);
    setMessages(chat.messages);
    setActiveAgent(chat.agentId ? getAgentById(chat.agentId) : null);
    setActiveProviderId(chat.providerId ?? connected?.id ?? null);
    setTelegram(chat.telegram ?? null);
    setToolNeed(null);
    setGreeting(null);
    setError(null);
  }

  function handleEditMessage(content: string) {
    setInput(content);
  }

  async function persist(msgs: ChatMessage[], id: string, agentId?: string, providerId?: string) {
    if (!user) return;
    await saveChatMessages(user.uid, id, msgs, agentId, providerId);
    await refreshChats();
  }

  function handleSelectProviderForChat(providerId: string) {
    setActiveProviderId(providerId);
    if (user && chatId) {
      saveChatMessages(user.uid, chatId, messages, activeAgent?.id, providerId);
    }
  }

  async function handleModelChange(model: string) {
    if (!user || !activeConnection) return;
    await updateConnectionModel(user.uid, activeConnection.provider.id, model);
    setConnections((prev) =>
      prev.map((c) => (c.provider.id === activeConnection.provider.id ? { ...c, model } : c))
    );
  }

  async function handleSend(e: FormEvent) {
    e.preventDefault();
    if (!input.trim()) return;

    if (!activeConnection || !user) {
      setForceSelect(true);
      setModalOpen(true);
      return;
    }

    const { provider, apiKey: activeKey, model } = activeConnection;
    const task = input.trim();
    const userMessage: ChatMessage = { role: "user", content: task };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setInput("");
    setError(null);
    setGreeting(null);
    setToolNeed(null);

    let currentChatId = chatId;
    if (!currentChatId) {
      currentChatId = await createChat(user.uid, task);
      setChatId(currentChatId);
    }

    // 0. Scheduling request? ("give me AI news daily at 10am")
    const intent = await detectScheduleIntent(provider.id, activeKey, task, model);
    if (intent) {
      const runAt = nextOccurrence(intent.time);
      await addScheduledTask(user.uid, intent.taskMessage, runAt, intent.recurrence, currentChatId);
      const confirmation: ChatMessage = {
        role: "assistant",
        content: `Done — I've scheduled "${intent.taskMessage}" to run ${
          intent.recurrence === "daily" ? "every day" : "once"
        } at ${intent.time}. I'll post the result right here in this chat each time it runs (also visible under Scheduler).`,
      };
      const finalMessages = [...nextMessages, confirmation];
      setMessages(finalMessages);
      await persist(finalMessages, currentChatId, activeAgent?.id, provider.id);
      return;
    }

    // 0.5 Does this need a tool the agent doesn't have? A plugin counts as
    // "connected" here if either its own toggle is on, OR a real MCP
    // server already covers it (e.g. an MCP server named "Gmail") — this
    // is what stops the agent asking to "connect Gmail in Plugins" when
    // Gmail is already working through MCP.
    const effectiveToolIds = effectiveConnectedToolIds(connectedToolIds, mcpServers);
    const need = await detectToolNeed(provider.id, activeKey, task, effectiveToolIds, model);
    if (need && !need.connected) {
      setToolNeed(need);
      await persist(nextMessages, currentChatId, activeAgent?.id, provider.id);
      return;
    }

    // 1. Boss agent decides which specialist should handle this task.
    setClassifying(true);
    const agent = await classifyAgent(provider.id, activeKey, task, model);
    setActiveAgent(agent);
    setClassifying(false);

    // 1.5 If an MCP tool (e.g. Creatify) looks relevant, actually call it
    // for real via our server route, and fold the result into the reply.
    let toolResultNote = "";
    if (mcpServers.length > 0) {
      const toolCall = await decideMcpToolCall(provider.id, activeKey, task, mcpServers, model);
      if (toolCall) {
        setUsingMcpTool(toolCall.toolName);
        try {
          const result = await callMcpTool(toolCall.serverId, toolCall.toolName, toolCall.arguments);
          toolResultNote = `You just used the "${toolCall.toolName}" tool and got this result:\n${result}\n\nIncorporate this into your reply to the user naturally — don't just repeat it verbatim, explain what it means.`;
        } catch (err) {
          toolResultNote = `You attempted to use the "${toolCall.toolName}" tool but the call failed: ${
            err instanceof Error ? err.message : "unknown error"
          }. Tell the user plainly that the tool call failed and why, so they can fix it (e.g. a missing API key, or the request needs more specific details).`;
        }
        setUsingMcpTool(null);
      }
    }

    // 1.6 Same idea, but for plugins with a real dedicated connection
    // (like Gmail via OAuth) — actually send the email / create the
    // draft / etc. instead of just talking about it.
    if (effectiveToolIds.length > 0) {
      const planned = await decidePluginAction(provider.id, activeKey, task, connectedToolIds, model);
      if (planned) {
        setUsingPluginAction(planned.actionName);
        try {
          const result = await callPluginAction(planned.toolId, planned.actionId, planned.params);
          toolResultNote += `\n\nYou just used "${planned.actionName}" for real and got this result:\n${result}\n\nTell the user what happened, referencing the real outcome above.`;
        } catch (err) {
          toolResultNote += `\n\nYou attempted "${planned.actionName}" but it failed: ${
            err instanceof Error ? err.message : "unknown error"
          }. Tell the user plainly what went wrong.`;
        }
        setUsingPluginAction(null);
      }
    }

    // 2. The chosen specialist answers for real — with Business DNA, its
    // connected-tools awareness, and any MCP tool result layered in.
    setSending(true);
    const toolNames = connectedToolNames(effectiveToolIds);
    const toolsContext =
      toolNames.length > 0
        ? `You currently have access to these connected tools: ${toolNames.join(", ")}. If asked to do something with one of them, answer as if you used it. If asked to do something requiring a tool NOT in this list, tell the user they can connect it in Plugins, or through MCP Tools if it's not a built-in plugin.`
        : "You don't have any tools connected yet. If a request needs an external tool (email, calendar, etc.), tell the user to connect it in Plugins or MCP Tools.";
    const systemPrompt = [
      agent.systemPrompt,
      buildBusinessContext(businessDNA),
      toolsContext,
      toolResultNote,
      "Formatting: use **bold** around the genuinely important parts of your answer — key numbers, names, decisions, or action items — so they stand out. Don't bold everything; be selective. Use markdown lists and short paragraphs where that helps readability.",
    ]
      .filter(Boolean)
      .join("\n\n");

    try {
      const { text, usage } = await sendChatMessage({
        providerId: provider.id,
        apiKey: activeKey,
        messages: nextMessages,
        systemPrompt,
        model,
      });
      const finalMessages = [...nextMessages, { role: "assistant" as const, content: text, usage }];
      setMessages(finalMessages);
      await persist(finalMessages, currentChatId, agent.id, provider.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSending(false);
    }
  }

  const codeFiles = extractCodeFiles(messages);

  return (
    <main className="flex h-screen overflow-hidden bg-cream">
      <Sidebar
        userLabel={user.email ?? user.displayName ?? "Account"}
        connected={connected}
        chats={chats}
        activeChatId={chatId}
        onSelectChat={handleSelectChat}
        onNewChat={handleNewChat}
        onSwitchModel={() => {
          setForceSelect(false);
          setModalOpen(true);
        }}
        onOpenScheduler={() => setSchedulerOpen(true)}
        onOpenPlugins={() => {
          setHighlightToolId(null);
          setPluginsOpen(true);
        }}
        onOpenMCP={() => setMcpOpen(true)}
        onOpenBusinessDNA={() => setBusinessOpen(true)}
        onLogout={() => signOut(auth)}
      />

      <section className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <div className="flex items-center justify-between border-b border-black/5 px-6 py-3">
          <span className="text-sm font-medium text-ink/70">
            {activeConnection ? `Chatting with ${activeConnection.provider.name}` : "Workspace"}
          </span>
          <div className="flex items-center gap-2">
            {activeConnection && (
              <ModelDropdown
                provider={activeConnection.provider}
                apiKey={activeConnection.apiKey}
                selectedModel={activeConnection.model ?? null}
                onChange={handleModelChange}
              />
            )}
            <AgentTeamPanel activeAgent={activeAgent} classifying={classifying} />
            {activeAgent?.isDeveloper && (
              <button
                onClick={() => setCodespaceOpen(true)}
                className="focus-ring flex items-center gap-2 rounded-md border border-ink/10 bg-white px-3 py-1.5 text-xs font-medium text-ink/80 transition-all hover:-translate-y-0.5 hover:shadow-sm"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-[#4D6BFE]" />
                Codespace
              </button>
            )}
            <button
              onClick={() => setSettingsOpen(true)}
              aria-label="Settings"
              className="focus-ring flex h-7 w-7 items-center justify-center rounded-md border border-ink/10 bg-white text-ink/60 transition-all hover:-translate-y-0.5 hover:text-ink hover:shadow-sm"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                <circle cx="7" cy="7" r="1.8" stroke="currentColor" strokeWidth="1.2" />
                <path
                  d="M7 1.5v1.3M7 11.2v1.3M2.5 7H1.2M12.8 7h-1.3M3.6 3.6l.9.9M9.5 9.5l.9.9M10.4 3.6l-.9.9M4.5 9.5l-.9.9"
                  stroke="currentColor"
                  strokeWidth="1.1"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto bg-cream-dark/40 px-6 py-8">
          <div className="mx-auto flex max-w-3xl flex-col gap-6">
            {mcpBanner && (
              <div
                className={`animate-fade-in-up rounded-md border px-4 py-2.5 text-sm ${
                  mcpBanner.type === "success"
                    ? "border-moss/30 bg-moss/10 text-moss"
                    : "border-red-200 bg-red-50 text-red-700"
                }`}
              >
                {mcpBanner.text}
              </div>
            )}
            {messages.length === 0 && (
              <div className="animate-fade-in-up mt-16 text-center">
                <h1 className="font-serif text-3xl text-ink">
                  Welcome{user.displayName ? `, ${user.displayName}` : ""}
                </h1>
                {generatingGreeting ? (
                  <p className="mt-2 text-sm text-ink/40">Saying hello properly...</p>
                ) : greeting ? (
                  <p className="mx-auto mt-2 max-w-md text-ink/70">{greeting}</p>
                ) : (
                  <p className="mt-2 text-ink/55">
                    {activeConnection
                      ? `Ask ${activeConnection.provider.name} anything to get started.`
                      : "Connect a provider to start chatting."}
                  </p>
                )}
              </div>
            )}

            {messages.map((m, i) => (
              <ChatMessageItem key={i} message={m} onEdit={i === messages.length - 1 && m.role === "user" ? handleEditMessage : undefined} />
            ))}

            {toolNeed && (
              <ToolConnectPrompt
                need={toolNeed}
                onOpenPlugins={() => {
                  setHighlightToolId(toolNeed.toolId);
                  setPluginsOpen(true);
                }}
                onOpenMCP={() => setMcpOpen(true)}
              />
            )}

            {classifying && (
              <p className="animate-fade-in text-xs text-ink/40">
                The boss agent is choosing the right specialist for this task...
              </p>
            )}
            {usingMcpTool && (
              <p className="animate-fade-in text-xs text-ink/40">
                Using {usingMcpTool}...
              </p>
            )}
            {usingPluginAction && (
              <p className="animate-fade-in text-xs text-ink/40">
                {usingPluginAction}...
              </p>
            )}
            {sending && <TypingIndicator />}

            {error && (
              <div className="animate-fade-in-up rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}
          </div>
        </div>

        {/* Composer */}
        <div className="border-t border-black/5 bg-cream px-6 py-4">
          <form
            onSubmit={handleSend}
            className="mx-auto flex max-w-3xl items-end gap-2 rounded-2xl border border-ink/10 bg-white px-3 py-2 shadow-sm transition-shadow focus-within:shadow-md"
          >
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend(e as unknown as FormEvent);
                }
              }}
              rows={1}
              placeholder={
                activeConnection
                  ? `Message ${activeConnection.provider.name}...`
                  : "Connect a provider to start chatting..."
              }
              className="max-h-40 flex-1 resize-none bg-transparent px-2 py-2 text-[15px] text-ink outline-none placeholder:text-ink/40"
            />
            <button
              type="submit"
              disabled={!input.trim() || sending}
              aria-label="Send message"
              className="focus-ring flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ink text-cream transition-all hover:scale-105 disabled:cursor-not-allowed disabled:opacity-30"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                <path d="M2 7h10M7 2l5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </form>
          <p className="mx-auto mt-2 max-w-3xl text-center text-xs text-ink/35">
            AgenticVenus uses your own API key — responses come directly
            from {activeConnection ? activeConnection.provider.name : "your chosen provider"}.
          </p>
        </div>
      </section>

      <ModelSelectorModal
        uid={user.uid}
        open={modalOpen}
        forceSelect={forceSelect}
        onClose={() => setModalOpen(false)}
        onConnected={handleConnected}
      />

      <SchedulerPanel
        uid={user.uid}
        open={schedulerOpen}
        onClose={() => setSchedulerOpen(false)}
        hasConnection={!!connected}
      />
      <PluginsPanel
        uid={user.uid}
        open={pluginsOpen}
        onClose={() => setPluginsOpen(false)}
        highlightToolId={highlightToolId}
        onConnectionsChange={setConnectedToolIds}
        onOpenMcpWithPrefill={(name, url) => {
          setMcpPrefill({ name, url });
          setPluginsOpen(false);
          setMcpOpen(true);
        }}
      />
      <MCPPanel
        uid={user.uid}
        open={mcpOpen}
        prefill={mcpPrefill}
        onClose={async () => {
          setMcpOpen(false);
          setMcpPrefill(null);
          setMcpServers(await listMCPServers(user.uid));
        }}
      />
      <BusinessDNAPanel
        uid={user.uid}
        open={businessOpen}
        onClose={() => setBusinessOpen(false)}
        onSaved={(dna) => {
          setBusinessDNA(dna);
          setGreeting(null);
        }}
      />
      <CodespacePanel
        open={codespaceOpen}
        onClose={() => setCodespaceOpen(false)}
        files={codeFiles}
      />
      <SettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        connections={connections}
        activeProviderId={activeConnection?.provider.id ?? null}
        onSelectProvider={handleSelectProviderForChat}
        onConnectAnother={() => {
          setForceSelect(false);
          setSettingsOpen(false);
          setModalOpen(true);
        }}
        chatId={chatId}
        telegram={telegram}
        onTelegramChange={setTelegram}
      />
    </main>
  );
}