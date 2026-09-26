import { auth } from "@/lib/firebase";

async function headers() {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error("Not signed in.");
  return { "content-type": "application/json", authorization: `Bearer ${token}` };
}

export async function startAgentJob(chatId: string, task: string, onState?: (job:any)=>void) {
  const res = await fetch("/api/agent/run?stream=1", { method: "POST", headers: await headers(), body: JSON.stringify({ chatId, task, stream:true }) });
  if (!res.ok) { const data=await res.json().catch(()=>({})); throw new Error(data?.error || "Agent runtime failed."); }
  if (!res.body) throw new Error("Agent runtime stream unavailable.");
  const reader=res.body.getReader(); const decoder=new TextDecoder(); let buffer=""; let finalJob:any=null;
  while(true){
    const {value,done}=await reader.read(); if(done) break;
    buffer+=decoder.decode(value,{stream:true});
    const chunks=buffer.split("\n\n"); buffer=chunks.pop()||"";
    for(const chunk of chunks){
      const line=chunk.split("\n").find(l=>l.startsWith("data: ")); if(!line) continue;
      try{ const data=JSON.parse(line.slice(6)); onState?.(data); if(chunk.includes("event: done")) finalJob=data; }catch{}
    }
  }
  return finalJob;
}

export async function getAgentJob(jobId: string) {
  const res = await fetch(`/api/agent/status?id=${encodeURIComponent(jobId)}`, { headers: await headers(), cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || "Could not read agent job.");
  return data.job;
}
