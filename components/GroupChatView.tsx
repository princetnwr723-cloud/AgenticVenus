"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatGroup } from "@/lib/chatGroups";
import { getChatGroupMessages, saveChatGroupMessages } from "@/lib/chatGroups";
import { getAgentIdentity, type AgentIdentity } from "@/lib/agentIdentity";
import { sendChatMessage, type ChatMessage } from "@/lib/chatClient";
import AnimatedAvatar from "@/components/AnimatedAvatar";
import { renderMarkdown } from "@/lib/markdown";

type GroupMsg = ChatMessage & { agentName?: string; avatarSeed?: string };

type Props = {
  uid: string;
  group: ChatGroup;
  providerId: string;
  apiKey: string;
  model?: string;
};

export default function GroupChatView({ uid, group, providerId, apiKey, model }: Props) {
  const [messages, setMessages] = useState<GroupMsg[]>([]);
  const [identities, setIdentities] = useState<Record<string, AgentIdentity>>({});
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (async () => {
      const [msgs, ids] = await Promise.all([
        getChatGroupMessages(uid, group.id),
        Promise.all(group.chatIds.map((id) => getAgentIdentity(uid, id))),
      ]);
      setMessages(msgs);
      const map: Record<string, AgentIdentity> = {};
      group.chatIds.forEach((id, i) => (map[id] = ids[i]));
      setIdentities(map);
    })();
  }, [uid, group.id, group.chatIds]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, sending]);

  async function handleSend() {
    if (!input.trim() || sending) return;
    const task = input.trim();
    setInput("");
    let running: GroupMsg[] = [...messages, { role: "user", content: task }];
    setMessages(running);
    setSending(true);

    for (const chatId of group.chatIds) {
      const identity = identities[chatId];
      if (!identity) continue;
      const soFar = running.map((m) => (m.role === "user" ? `User: ${m.content}` : `${m.agentName || "Agent"}: ${m.content}`)).join("\n");
      const prompt = `You are ${identity.name}, one member of a group of AI agents talking together. ${
        identity.customPrompt ? identity.customPrompt + " " : ""
      }Conversation so far:\n${soFar}\n\nGive your response as ${identity.name} — build on what's been said, don't just repeat it. Keep it focused.`;
      try {
        const { text } = await sendChatMessage({ providerId, apiKey, model, messages: [{ role: "user", content: prompt }] });
        running = [...running, { role: "assistant", content: text, agentName: identity.name, avatarSeed: identity.avatarSeed }];
        setMessages(running);
      } catch {
        // one agent failing shouldn't stop the rest
      }
    }

    await saveChatGroupMessages(uid, group.id, running);
    setSending(false);
  }

  return (
    <div className="flex h-full flex-col">
      <div ref={scrollRef} className="flex-1 overflow-y-auto bg-cream-dark/40 px-6 py-8">
        <div className="mx-auto flex max-w-3xl flex-col gap-6">
          {messages.length === 0 && (
            <p className="mt-16 text-center text-ink/50">
              {group.chatIds.length} agents are in this group — send a message to get them talking.
            </p>
          )}
          {messages.map((m, i) =>
            m.role === "user" ? (
              <div key={i} className="flex flex-col items-end">
                <div className="max-w-[75%] rounded-2xl bg-sand px-4 py-2.5 text-[15px] leading-relaxed text-ink">{m.content}</div>
              </div>
            ) : (
              <div key={i} className="flex gap-3">
                <AnimatedAvatar seed={m.avatarSeed || m.agentName || "a1"} size={24} />
                <div className="min-w-0 flex-1">
                  {m.agentName && <p className="mb-1 text-xs font-medium text-ink/50">{m.agentName}</p>}
                  <div className="max-w-[85%] rounded-2xl bg-cream-dark/70 px-4 py-3">
                    <div className="text-[15px] leading-relaxed text-ink" dangerouslySetInnerHTML={{ __html: renderMarkdown(m.content) }} />
                  </div>
                </div>
              </div>
            )
          )}
          {sending && <p className="text-xs text-ink/40">The group is talking...</p>}
        </div>
      </div>
      <div className="border-t border-black/5 bg-cream px-6 py-4">
        <div className="mx-auto flex max-w-3xl items-end gap-2 rounded-2xl border border-ink/10 bg-white px-3 py-2 shadow-sm">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            rows={1}
            placeholder={`Message the ${group.name} group...`}
            className="max-h-40 flex-1 resize-none bg-transparent px-2 py-2 text-[15px] text-ink outline-none"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || sending}
            className="focus-ring flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ink text-cream disabled:opacity-30"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M2 7h10M7 2l5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}