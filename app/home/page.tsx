"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useAuth } from "@/components/AuthProvider";
import ModelSelectorModal from "@/components/ModelSelectorModal";
import Sidebar from "@/components/Sidebar";
import { ChatMessageItem, TypingIndicator } from "@/components/ChatMessage";
import { getPrimaryConnection } from "@/lib/connections";
import { sendChatMessage, type ChatMessage } from "@/lib/chatClient";
import type { Provider } from "@/lib/providers";

export default function HomePage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  const [checkingConnection, setCheckingConnection] = useState(true);
  const [connected, setConnected] = useState<Provider | null>(null);
  const [apiKey, setApiKey] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [forceSelect, setForceSelect] = useState(false);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);

  // Redirect unauthenticated visitors to log in.
  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
    }
  }, [loading, user, router]);

  // Once we know who the user is, check whether they've already connected
  // a provider. If not, this is their first visit — force the selector.
  useEffect(() => {
    if (!user) return;
    (async () => {
      const existing = await getPrimaryConnection(user.uid);
      if (existing) {
        setConnected(existing.provider);
        setApiKey(existing.apiKey);
      } else {
        setForceSelect(true);
        setModalOpen(true);
      }
      setCheckingConnection(false);
    })();
  }, [user]);

  // Pick up a draft message typed on the landing page before signing up.
  useEffect(() => {
    const draft = sessionStorage.getItem("agenticvenus_draft");
    if (draft) {
      setInput(draft);
      sessionStorage.removeItem("agenticvenus_draft");
    }
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, sending]);

  if (loading || !user || checkingConnection) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-cream">
        <p className="animate-fade-in text-sm text-ink/50">Loading your workspace...</p>
      </main>
    );
  }

  function handleConnected(provider: Provider, key: string) {
    setConnected(provider);
    setApiKey(key);
    setForceSelect(false);
  }

  function handleNewChat() {
    setMessages([]);
    setError(null);
    setInput("");
  }

  async function handleSend(e: FormEvent) {
    e.preventDefault();
    if (!input.trim()) return;

    if (!connected || !apiKey) {
      setForceSelect(true);
      setModalOpen(true);
      return;
    }

    const userMessage: ChatMessage = { role: "user", content: input.trim() };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setInput("");
    setSending(true);
    setError(null);

    try {
      const reply = await sendChatMessage({
        providerId: connected.id,
        apiKey,
        messages: nextMessages,
      });
      setMessages([...nextMessages, { role: "assistant", content: reply }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSending(false);
    }
  }

  return (
    <main className="flex h-screen overflow-hidden bg-cream">
      <Sidebar
        userLabel={user.email ?? user.displayName ?? "Account"}
        connected={connected}
        hasMessages={messages.length > 0}
        onNewChat={handleNewChat}
        onSwitchModel={() => {
          setForceSelect(false);
          setModalOpen(true);
        }}
        onLogout={() => signOut(auth)}
      />

      <section className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <div className="flex items-center justify-between border-b border-black/5 px-6 py-3">
          <span className="text-sm font-medium text-ink/70">
            {connected ? `Chatting with ${connected.name}` : "Workspace"}
          </span>
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-8">
          <div className="mx-auto flex max-w-3xl flex-col gap-6">
            {messages.length === 0 && (
              <div className="animate-fade-in-up mt-16 text-center">
                <h1 className="font-serif text-3xl text-ink">
                  Welcome{user.displayName ? `, ${user.displayName}` : ""}
                </h1>
                <p className="mt-2 text-ink/55">
                  {connected
                    ? `Ask ${connected.name} anything to get started.`
                    : "Connect a provider to start chatting."}
                </p>
              </div>
            )}

            {messages.map((m, i) => (
              <ChatMessageItem key={i} message={m} />
            ))}

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
                connected
                  ? `Message ${connected.name}...`
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
                <path
                  d="M2 7h10M7 2l5 5-5 5"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </form>
          <p className="mx-auto mt-2 max-w-3xl text-center text-xs text-ink/35">
            AgenticVenus uses your own API key — responses come directly
            from {connected ? connected.name : "your chosen provider"}.
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
    </main>
  );
}