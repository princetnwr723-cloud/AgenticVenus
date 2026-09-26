// Durable server-side Agent Runtime. The browser is only a client/viewer;
// task state lives in Firestore so execution can be resumed by a tick worker.
import { adminDb } from "@/lib/firebaseAdmin";
import { decryptSecret } from "@/lib/secretsVault";
import { runAutonomousReply, getBusinessDNAAdmin } from "@/lib/serverAgentTools";
import { decideAutoTools } from "@/lib/autoTools";
import { classifyAgent } from "@/lib/agents";
import { runServerDeveloperWorkspace } from "@/lib/serverDeveloperRuntime";
import { looksLikeDeveloperTask } from "@/lib/developerRuntime";
import { resolveAllIntegrationSecrets } from "@/lib/secretsResolve";
import { signPreviewToken } from "@/lib/previewToken";
import { runServerBrowserTask } from "@/lib/serverBrowserRuntime";
import { runServerComputerTask } from "@/lib/serverComputerRuntime";
import { verifyTaskResult } from "@/lib/verification";
import type { ChatMessage } from "@/lib/chatClient";

export type AgentJob = {
  id: string; uid: string; chatId: string; task: string; attachments?: any[];
  status: "queued"|"running"|"completed"|"failed"|"needs_input";
  phase?: string; agentId?: string; steps?: string[]; resultText?: string;
  error?: string; previewUrl?: string; browserLiveUrl?: string; computerLiveUrl?: string;
  createdAt: number; updatedAt: number; leaseUntil?: number;
};

function jobs(uid: string) { return adminDb().collection("users").doc(uid).collection("agentJobs"); }

async function primaryProvider(uid: string) {
  const snap = await adminDb().collection("users").doc(uid).collection("connections").orderBy("connectedAt", "desc").limit(1).get();
  if (snap.empty) return null;
  const d = snap.docs[0].data();
  if (!d.apiKey_enc || !d.providerId) return null;
  return { providerId: d.providerId as string, apiKey: decryptSecret(d.apiKey_enc), model: d.model as string|undefined };
}

export async function createAgentJob(uid: string, chatId: string, task: string, attachments: any[] = []) {
  const ref = jobs(uid).doc();
  const job: AgentJob = { id: ref.id, uid, chatId, task, attachments, status: "queued", phase: "queued", steps: [], createdAt: Date.now(), updatedAt: Date.now() };
  await ref.set(job);
  return job;
}

export async function getAgentJob(uid: string, id: string) {
  const s = await jobs(uid).doc(id).get();
  return s.exists ? ({ id: s.id, ...(s.data() as any) } as AgentJob) : null;
}

async function patch(uid: string, id: string, data: Partial<AgentJob>) {
  await jobs(uid).doc(id).set({ ...data, updatedAt: Date.now() }, { merge: true });
}

async function appendChat(uid: string, chatId: string, content: string) {
  const ref = adminDb().collection("users").doc(uid).collection("chats").doc(chatId);
  const snap = await ref.get(); if (!snap.exists) return;
  const messages = snap.data()?.messages || [];
  await ref.update({ messages: [...messages, { role: "assistant", content }], updatedAt: new Date() });
}

export async function runAgentJob(uid: string, id: string) {
  const ref = jobs(uid).doc(id);
  const claimed = await adminDb().runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) return false;
    const data = snap.data() as AgentJob;
    if (data.status === "completed" || data.status === "failed" || data.status === "needs_input") return false;
    if (data.status === "running" && (data.leaseUntil || 0) > Date.now()) return false;
    tx.set(ref, { status: "running", phase: "understanding", leaseUntil: Date.now() + 15 * 60_000, updatedAt: Date.now() }, { merge: true });
    return true;
  });
  if (!claimed) return getAgentJob(uid, id);
  const current = await getAgentJob(uid, id); if (!current) return null;
  const provider = await primaryProvider(uid);
  if (!provider) { await patch(uid, id, { status: "needs_input", phase: "needs_provider", error: "Connect an AI provider first." }); return getAgentJob(uid,id); }

  const keys = await resolveAllIntegrationSecrets(uid);
  const agent = await classifyAgent(provider.providerId, provider.apiKey, current.task, provider.model);
  await patch(uid, id, { agentId: agent.id, phase: "planning", steps: [`Assigned ${agent.name}.`] });

  const rawDecision = await decideAutoTools(provider.providerId, provider.apiKey, current.task, !!keys.browserlessApiKey, !!keys.daytonaApiKey, [], provider.model);
  // Browser is a capability, not a single vendor. If Browserless is absent but
  // the persistent Daytona PC exists, use its real desktop browser as the
  // fallback instead of telling the user that browsing is impossible.
  const decision = { ...rawDecision };
  if (decision.browserUnavailable && keys.daytonaApiKey) {
    decision.browserUnavailable = false;
    decision.needsBrowser = false;
    decision.needsComputer = true;
  }
  if (decision.browserUnavailable) { await patch(uid,id,{status:"needs_input",phase:"needs_browser",error:"This task genuinely needs live web access, but no browser capability is connected. Connect Browserless or Daytona and retry."}); return getAgentJob(uid,id); }
  if (decision.computerUnavailable) { await patch(uid,id,{status:"needs_input",phase:"needs_computer",error:"This task genuinely needs a cloud desktop, but Daytona is not connected. Connect Daytona in Settings → Integrations and retry."}); return getAgentJob(uid,id); }

  try {
    let resultText = ""; let previewUrl: string|undefined; let computerLiveUrl: string|undefined;
    const chatSnap = await adminDb().collection("users").doc(uid).collection("chats").doc(current.chatId).get();
    const storedMessages = (chatSnap.exists ? (chatSnap.data()?.messages || []) : []) as ChatMessage[];
    const history: ChatMessage[] = storedMessages.slice(-12);
    const step = async (s: string) => { const j = await getAgentJob(uid,id); await patch(uid,id,{phase:"executing",steps:[...(j?.steps||[]),s].slice(-50)}); };

    let toolEvidence = "";
    if (looksLikeDeveloperTask(current.task) && keys.daytonaApiKey) {
      const dev = await runServerDeveloperWorkspace(uid, provider.providerId, provider.apiKey, current.task, provider.model, history, "primary", "", step);
      resultText = `Completed the development task.\n\nChanged files: ${dev.changedFiles.join(", ") || "none"}\nBuild: ${dev.buildOk ? "PASS" : "FAIL"}${dev.previewUrl ? `\nLive preview: ${dev.previewUrl}` : ""}\n\n${dev.buildOutput.slice(-5000)}`;
      previewUrl = dev.previewUrl;
      if (dev.buildOk) {
        const state = await adminDb().collection("users").doc(uid).collection("agentWorkspace").doc("default").get();
        const sandboxId = state.data()?.sandboxId as string|undefined;
        if (sandboxId) computerLiveUrl = `/api/preview/${signPreviewToken({uid,sandboxId,port:6080})}/vnc.html?autoconnect=true&resize=remote`;
      }
    } else if (decision.needsBrowser) {
      await step("🌐 Browser capability detected — starting the persistent browser…");
      try {
        const browser = await runServerBrowserTask(uid, provider.providerId, provider.apiKey, current.task, provider.model, step, async (liveUrl) => { if (liveUrl) await patch(uid,id,{browserLiveUrl: liveUrl, phase:"executing"}); });
        toolEvidence = `REAL BROWSER RESULT:\n${browser.summary}`;
        resultText = browser.summary;
        if (browser.liveUrl) await patch(uid,id,{previewUrl: browser.liveUrl, browserLiveUrl: browser.liveUrl});
      } catch (browserError) {
        // Browserless can expire, hit a site-specific block, or become
        // unreachable. If the user has a persistent Daytona PC, continue the
        // same task through the real desktop browser rather than failing the
        // entire task.
        if (!keys.daytonaApiKey) throw browserError;
        await step(`🌐 Browser service failed — falling back to the persistent PC browser…`);
        const computer = await runServerComputerTask(uid, provider.providerId, provider.apiKey, current.task, provider.model, step, async (liveUrl) => { computerLiveUrl = liveUrl; await patch(uid,id,{computerLiveUrl: liveUrl, phase:"executing"}); });
        toolEvidence = `REAL COMPUTER-BROWSER FALLBACK RESULT:\n${computer.summary}`;
        resultText = computer.summary;
        computerLiveUrl = computer.liveUrl;
      }
    } else if (decision.needsComputer) {
      await step("🖥️ Computer capability detected — starting the persistent cloud PC…");
      const computer = await runServerComputerTask(uid, provider.providerId, provider.apiKey, current.task, provider.model, step, async (liveUrl) => { computerLiveUrl = liveUrl; await patch(uid,id,{computerLiveUrl: liveUrl, phase:"executing"}); });
      toolEvidence = `REAL COMPUTER RESULT:\n${computer.summary}`;
      resultText = computer.summary;
      computerLiveUrl = computer.liveUrl;
    } else {
      await step("Executing with connected tools…");
      const reply = await runAutonomousReply(uid, provider.providerId, provider.apiKey, agent.id, history, await getBusinessDNAAdmin(uid), provider.model);
      resultText = reply.text;
    }

    // Independent verification is mandatory for real browser/computer work.
    // If verification cannot establish success, do not mark the job completed.
    if (toolEvidence) {
      await step("🔎 Verifying the real-world result…");
      const verdict = await verifyTaskResult(provider.providerId, provider.apiKey, current.task, toolEvidence, provider.model);
      if (!verdict.verified) throw new Error(`Result could not be verified: ${verdict.reason || "insufficient evidence"}`);
      const final = await runAutonomousReply(uid, provider.providerId, provider.apiKey, agent.id, [...history, { role: "user", content: `Task: ${current.task}\n\n${toolEvidence}\n\nThe result was independently verified. Write the final answer based ONLY on this evidence. Do not invent actions or results.` }], await getBusinessDNAAdmin(uid), provider.model);
      resultText = final.text;
    }

    await patch(uid,id,{phase:"completed",status:"completed",resultText,previewUrl,computerLiveUrl,leaseUntil:0});
    await appendChat(uid,current.chatId,resultText);
    return getAgentJob(uid,id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await patch(uid,id,{status:"failed",phase:"failed",error:message,leaseUntil:0});
    await appendChat(uid,current.chatId,`I couldn't complete that task. **Error:** ${message}`);
    return getAgentJob(uid,id);
  }
}

export async function recoverExpiredJobs(uid?: string) {
  const cutoff = Date.now();
  const targets = uid ? [uid] : [];
  let count = 0;
  for (const userId of targets) {
    const snap = await jobs(userId).where("status","in",["queued","running"]).get();
    for (const d of snap.docs) {
      const j = d.data() as AgentJob;
      if (j.status === "queued" || (j.leaseUntil || 0) < cutoff) { await runAgentJob(userId,d.id); count++; }
    }
  }
  return count;
}
