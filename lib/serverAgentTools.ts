// lib/serverAgentTools.ts
// Admin-SDK equivalents of the client-side helpers used by app/home/page.tsx,
// so any SERVER route (Telegram webhook, future scheduled/background jobs)
// can run the exact same autonomous loop — browser/computer auto-use, skill
// auto-install, plugin/MCP actions — without needing a browser context.

import { adminDb } from "@/lib/firebaseAdmin";
import { sendChatMessage, type ChatMessage } from "@/lib/chatClient";
import { classifyAgent, getAgentById } from "@/lib/agents";
import { buildBusinessContext, type BusinessDNA } from "@/lib/businessDNA";
import { SKILLS_CATALOG, type Skill } from "@/lib/skills";
import { parseSkillMd } from "@/lib/skillImport";
import { detectScheduleIntent } from "@/lib/scheduleDetect";
import { decideAutoTools } from "@/lib/autoTools";
import { decideMcpToolCall } from "@/lib/mcpOrchestrator";
import { mcpCallTool } from "@/lib/mcpClient";
import { runPluginAction } from "@/lib/pluginRuntime";
import { connectedToolNames, effectiveConnectedToolIds } from "@/lib/pluginConnections";
import { startBrowserSession, runBrowserAction, stopBrowserSession, type BrowserAction } from "@/lib/browserUse";
import { startComputer, runComputerAction, stopComputer, type ComputerAction } from "@/lib/computerUse";
import type { IntegrationKeys } from "@/lib/integrationKeys";
import type { MCPServer } from "@/lib/mcp";

export async function getIntegrationKeysAdmin(uid: string) {
  const { resolveAllIntegrationSecrets } = await import("@/lib/secretsResolve");
  return resolveAllIntegrationSecrets(uid);
}

export async function getBusinessDNAAdmin(uid: string): Promise<BusinessDNA | null> {
  const snap = await adminDb().collection("users").doc(uid).collection("settings").doc("businessDNA").get();
  if (!snap.exists) return null;
  const data = snap.data()!;
  if (!data.businessName) return null;
  return data as BusinessDNA;
}

export async function listInstalledSkillIdsAdmin(uid: string): Promise<string[]> {
  const snap = await adminDb().collection("users").doc(uid).collection("installedSkills").get();
  return snap.docs.map((d) => d.id);
}

export async function listCustomSkillsAdmin(uid: string): Promise<Skill[]> {
  const snap = await adminDb().collection("users").doc(uid).collection("customSkills").get();
  return snap.docs.map((d) => d.data() as Skill);
}

export async function saveCustomSkillAdmin(uid: string, skill: Skill, sourceUrl: string) {
  await adminDb().collection("users").doc(uid).collection("customSkills").doc(skill.id).set({
    ...skill,
    sourceUrl,
    installedAt: Date.now(),
  });
}

export function buildInstalledSkillsContextAdmin(installedIds: string[], customSkills: Skill[]): string {
  const catalogSkills = SKILLS_CATALOG.filter((s) => installedIds.includes(s.id));
  const skills = [...catalogSkills, ...customSkills];
  if (skills.length === 0) return "";
  return `Installed skills — apply these when relevant:\n${skills.map((s) => `- [${s.name}] ${s.instructions}`).join("\n")}`;
}

export async function listConnectedPluginIdsAdmin(uid: string): Promise<string[]> {
  const snap = await adminDb().collection("users").doc(uid).collection("pluginConnections").get();
  return snap.docs.map((d) => d.id);
}

export async function listMCPServersAdmin(uid: string): Promise<MCPServer[]> {
  const snap = await adminDb().collection("users").doc(uid).collection("mcpServers").orderBy("createdAt", "desc").get();
  return snap.docs.map((d) => ({ id: d.id, authType: "none", ...d.data() } as MCPServer));
}

async function resolveMcpAuthAdmin(uid: string, server: MCPServer): Promise<string | undefined> {
  if (server.authType === "apikey") return server.apiKeyHeader;
  if (server.authType === "oauth" && server.oauth) return `Bearer ${server.oauth.accessToken}`;
  return undefined;
}

async function importSkillFromUrlAdmin(url: string) {
  let fetchUrl = url;
  const ghMatch = fetchUrl.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/(.+)$/);
  if (ghMatch) fetchUrl = `https://raw.githubusercontent.com/${ghMatch[1]}/${ghMatch[2]}/${ghMatch[3]}`;
  const res = await fetch(fetchUrl);
  if (!res.ok) throw new Error(`Couldn't fetch that link (status ${res.status}).`);
  const text = await res.text();
  return parseSkillMd(text);
}

/**
 * Runs the SAME autonomous loop the web app uses — scheduling detection,
 * connected MCP/plugin actions, self-directed browser/computer use, skill
 * auto-install from a link — then produces the final reply. Used by the
 * Telegram webhook so Telegram gets full parity with the web UI.
 */
export async function runAutonomousReply(
  uid: string,
  providerId: string,
  apiKey: string,
  agentIdSaved: string | undefined,
  messages: ChatMessage[],
  businessDNA: BusinessDNA | null,
  model?: string
): Promise<{ text: string; agentId: string }> {
  const task = messages[messages.length - 1]?.content || "";

  const [intKeys, installedSkillIds, customSkills, connectedToolIds, mcpServers] = await Promise.all([
    getIntegrationKeysAdmin(uid),
    listInstalledSkillIdsAdmin(uid),
    listCustomSkillsAdmin(uid),
    listConnectedPluginIdsAdmin(uid),
    listMCPServersAdmin(uid),
  ]);
  const effectiveToolIds = effectiveConnectedToolIds(connectedToolIds, mcpServers);

  // Skill auto-install from a link, same as the web app.
  const autoDecision = await decideAutoTools(
    providerId, apiKey, task, !!intKeys.browserlessApiKey, !!intKeys.daytonaApiKey, [], model
  );

  if (autoDecision.installSkillUrl) {
    try {
      const parsed = await importSkillFromUrlAdmin(autoDecision.installSkillUrl);
      const skill: Skill = { id: parsed.id, name: parsed.name, category: "writing", description: parsed.description, color: "#8A8578", instructions: parsed.instructions };
      await saveCustomSkillAdmin(uid, skill, autoDecision.installSkillUrl);
      return { text: `Installed the **${skill.name}** skill from that link — I'll apply it automatically from now on.`, agentId: agentIdSaved || "generalist" };
    } catch (err) {
      return { text: `I couldn't install a skill from that link: ${err instanceof Error ? err.message : "unknown error"}.`, agentId: agentIdSaved || "generalist" };
    }
  }

  const agent = await classifyAgent(providerId, apiKey, task, model);

  let toolResultNote = "";

  if (mcpServers.length > 0) {
    const toolCall = await decideMcpToolCall(providerId, apiKey, messages, mcpServers, model);
    if (toolCall) {
      const server = mcpServers.find((s) => s.id === toolCall.serverId);
      try {
        const authHeader = server ? await resolveMcpAuthAdmin(uid, server) : undefined;
        const result = await mcpCallTool(server!.url, toolCall.toolName, toolCall.arguments, authHeader);
        toolResultNote += `\n\nYou just used the "${toolCall.toolName}" tool and got this result:\n${result}\n\nExplain what it means, don't just repeat it.`;
      } catch (err) {
        toolResultNote += `\n\nYou tried "${toolCall.toolName}" but it failed: ${err instanceof Error ? err.message : "unknown error"}.`;
      }
    }
  }

  if (effectiveToolIds.length > 0) {
    const { decidePluginAction } = await import("@/lib/pluginOrchestrator");
    const planned = await decidePluginAction(providerId, apiKey, messages, connectedToolIds, model);
    if (planned) {
      try {
        // Decrypts + refreshes the stored token/key, then runs the action.
        const result = await runPluginAction(uid, planned.toolId, planned.actionId, planned.params);
        toolResultNote += `\n\nYou just used "${planned.actionName}" for real:\n${result}`;
      } catch (err) {
        toolResultNote += `\n\nYou attempted "${planned.actionName}" but it failed: ${err instanceof Error ? err.message : "unknown error"}.`;
      }
    }
  }

  if (autoDecision.needsBrowser && intKeys.browserlessApiKey) {
    try {
      const { sessionId } = await startBrowserSession(uid, intKeys.browserlessApiKey);
      let lastText = "";
      for (let step = 0; step < 15; step++) {
        const shot = await runBrowserAction(uid, sessionId, { type: "screenshot" }, intKeys.browserlessApiKey);
        const prompt = `Operating a real browser via Telegram to accomplish: "${task}"\nDecide ONE action as JSON: {"action":"goto","url":"..."} | {"action":"click","x":n,"y":n} | {"action":"type","text":"..."} | {"action":"extractText"} | {"action":"done","summary":"..."}`;
        const { text } = await sendChatMessage({ providerId, apiKey, model, messages: [{ role: "user", content: prompt, attachments: shot.screenshotBase64 ? [{ name: "s.jpg", mimeType: "image/jpeg", dataUrl: `data:image/jpeg;base64,${shot.screenshotBase64}` }] : [] }] });
        let decision: any;
        try { decision = JSON.parse(text.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1] || text); } catch { break; }
        if (decision.action === "done") { lastText = decision.summary || "done"; break; }
        const action: BrowserAction =
          decision.action === "goto" ? { type: "goto", url: decision.url } :
          decision.action === "click" ? { type: "click", x: decision.x, y: decision.y } :
          decision.action === "type" ? { type: "type", text: decision.text } :
          decision.action === "extractText" ? { type: "extractText" } : { type: "wait", ms: 500 };
        const result = await runBrowserAction(uid, sessionId, action, intKeys.browserlessApiKey);
        if (result.text) lastText = result.text;
      }
      await stopBrowserSession(uid, sessionId);
      toolResultNote += `\n\nYou used the browser and found/did: ${lastText}\n\nMention this naturally.`;
    } catch (err) {
      toolResultNote += `\n\nYou tried to use the browser but it failed: ${err instanceof Error ? err.message : "unknown error"}.`;
    }
  }

  if (autoDecision.needsComputer && intKeys.daytonaApiKey) {
    try {
      const { sandboxId } = await startComputer(intKeys.daytonaApiKey);
      await new Promise((r) => setTimeout(r, 4000)); // let the desktop finish booting
      let lastSummary = "";
      for (let step = 0; step < 15; step++) {
        const shot = await runComputerAction(sandboxId, intKeys.daytonaApiKey, { type: "screenshot" });
        const prompt = `Operating a real remote desktop via Telegram to accomplish: "${task}"\nDecide ONE action as JSON: {"action":"click","x":n,"y":n} | {"action":"type","text":"..."} | {"action":"key","key":"..."} | {"action":"done","summary":"..."}`;
        const { text } = await sendChatMessage({ providerId, apiKey, model, messages: [{ role: "user", content: prompt, attachments: [{ name: "s.png", mimeType: "image/png", dataUrl: `data:image/png;base64,${shot.screenshotBase64}` }] }] });
        let decision: any;
        try { decision = JSON.parse(text.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1] || text); } catch { break; }
        if (decision.action === "done") { lastSummary = decision.summary || "done"; break; }
        const action: ComputerAction =
          decision.action === "click" ? { type: "click", x: decision.x, y: decision.y } :
          decision.action === "type" ? { type: "type", text: decision.text } :
          decision.action === "key" ? { type: "key", key: decision.key } : { type: "wait", ms: 500 };
        await runComputerAction(sandboxId, intKeys.daytonaApiKey, action);
      }
      await stopComputer(sandboxId, intKeys.daytonaApiKey);
      toolResultNote += `\n\nYou used the cloud computer and did: ${lastSummary}\n\nMention this naturally.`;
    } catch (err) {
      toolResultNote += `\n\nYou tried to use the computer but it failed: ${err instanceof Error ? err.message : "unknown error"}.`;
    }
  }

  const toolsContext = connectedToolNames(effectiveToolIds).length
    ? `You currently have access to these connected tools: ${connectedToolNames(effectiveToolIds).join(", ")}.`
    : "";
  const infraContext = [
    intKeys.daytonaApiKey ? "You have real, autonomous access to a cloud computer via Telegram — you decide when a task needs it." : null,
    intKeys.browserlessApiKey ? "You have real, autonomous browser access via Telegram — you decide when a task needs browsing/research." : null,
  ].filter(Boolean).join("\n");

  const systemPrompt = [
    agent.systemPrompt,
    buildBusinessContext(businessDNA),
    toolsContext,
    infraContext,
    buildInstalledSkillsContextAdmin(installedSkillIds, customSkills),
    toolResultNote,
  ].filter(Boolean).join("\n\n");

  const { text } = await sendChatMessage({ providerId, apiKey, model, messages, systemPrompt });
  return { text, agentId: agent.id };
}