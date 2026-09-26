import { NextRequest, NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebaseAdmin";
import { createAgentJob, runAgentJob } from "@/lib/agentRuntime";

export const maxDuration = 300;

async function uidFrom(req: NextRequest) {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Missing auth token.");
  return (await adminAuth().verifyIdToken(token)).uid;
}

const sleep = (ms:number) => new Promise(r => setTimeout(r, ms));

export async function POST(req: NextRequest) {
  try {
    const uid = await uidFrom(req);
    const body = await req.json();
    if (!body.chatId || !body.task) return NextResponse.json({ error: "chatId and task are required." }, { status: 400 });
    const job = await createAgentJob(uid, String(body.chatId), String(body.task), Array.isArray(body.attachments) ? body.attachments : []);
    const stream = body.stream === true || req.nextUrl.searchParams.get("stream") === "1";
    if (!stream) {
      const result = await runAgentJob(uid, job.id);
      return NextResponse.json({ ok:true, job:result || job });
    }

    const encoder = new TextEncoder();
    const execution = runAgentJob(uid, job.id).catch(async (err) => {
      // runAgentJob normally persists the failure itself; keep the stream alive
      // long enough for the client to receive the final state.
      return null;
    });
    const bodyStream = new ReadableStream({
      async start(controller) {
        const send = (event:string, data:any) => controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        send("job", job);
        let lastUpdated = 0;
        try {
          for (;;) {
            const current = await (await import("@/lib/agentRuntime")).getAgentJob(uid, job.id);
            if (current && (current.updatedAt !== lastUpdated || current.status !== "running")) {
              lastUpdated = current.updatedAt;
              send("state", current);
            }
            if (current && ["completed","failed","needs_input"].includes(current.status)) break;
            await sleep(500);
          }
          const finalJob = await execution;
          send("done", finalJob);
        } catch (err) {
          send("error", { error: err instanceof Error ? err.message : String(err) });
        } finally {
          controller.close();
        }
      }
    });
    return new Response(bodyStream, { headers: { "content-type":"text/event-stream; charset=utf-8", "cache-control":"no-cache, no-transform", "connection":"keep-alive" } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Agent job failed.";
    return NextResponse.json({ error: message }, { status: message.includes("auth") ? 401 : 500 });
  }
}
