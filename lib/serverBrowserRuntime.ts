import { sendChatMessage } from "@/lib/chatClient";
import { parseFirstJson } from "@/lib/agentJson";
import { adminDb } from "@/lib/firebaseAdmin";
import { startBrowserSession, runBrowserAction, type BrowserAction, type BrowserActionResult, type BrowserElement } from "@/lib/browserUse";

type BrowserDecision = {
  action: string; query?: string; engine?: "duckduckgo"|"google"|"bing"; url?: string; index?: number;
  x?: number; y?: number; text?: string; submit?: boolean; clear?: boolean; key?: string; amount?: number; ms?: number; summary?: string; reason?: string;
};

function elementsText(elements: BrowserElement[] = []) {
  return elements.slice(0, 60).map(e => `[${e.index}] ${e.tag} ${e.type || ""} "${e.label}" @ (${e.x},${e.y})`).join("\n") || "(none)";
}

async function getReusableSession(uid: string, apiKey: string) {
  const ref = adminDb().collection("users").doc(uid).collection("browserSessions").doc("primary");
  const snap = await ref.get();
  if (snap.exists) {
    const d = snap.data() as any;
    if (d.sessionId) {
      try {
        const state = await runBrowserAction(uid, d.sessionId, { type: "screenshot" }, apiKey);
        return { sessionId: d.sessionId as string, liveUrl: (d.liveUrl as string) || "", state };
      } catch { /* stale session; create a fresh one */ }
    }
  }
  const started = await startBrowserSession(uid, apiKey);
  await ref.set({ sessionId: started.sessionId, liveUrl: started.liveUrl || "", updatedAt: Date.now() }, { merge: true });
  const state = await runBrowserAction(uid, started.sessionId, { type: "screenshot" }, apiKey);
  return { sessionId: started.sessionId, liveUrl: started.liveUrl || "", state };
}

export async function runServerBrowserTask(uid: string, providerId: string, apiKey: string, task: string, model?: string, onStep?: (s:string)=>Promise<void>|void, onReady?: (liveUrl:string,sessionId:string)=>Promise<void>|void) {
  const session = await getReusableSession(uid, apiKey);
  let state = session.state;
  await onReady?.(session.liveUrl, session.sessionId);
  let lastExtract = "";
  let history: string[] = [];
  let hint = "";
  let parseFailures = 0;
  let actionErrors = 0;
  let lastSig = "";
  let repeats = 0;
  const collected: string[] = [];

  for (let step=0; step<35; step++) {
    const prompt = `You are an autonomous browser agent. Complete this task for real: "${task}"\n\nCURRENT PAGE: ${state.url || "blank"}\nTITLE: ${state.title || ""}\nVISIBLE CLICKABLE ELEMENTS:\n${elementsText(state.elements)}\n\nHISTORY:\n${history.slice(-10).join("\n") || "(none)"}\n${lastExtract ? `\nEXTRACTED TEXT:\n${lastExtract.slice(0,5000)}` : ""}\n${hint ? `\nNOTE: ${hint}` : ""}\n\nReturn ONLY JSON: search(query,engine), goto(url), click_element(index), click(x,y), type(text,submit,clear), key(key), scroll(amount), back, extractText, wait(ms), done(summary), fail(reason).\nUse extractText to read facts. Use click_element whenever possible. Verify the next screenshot after every action. Never claim done without evidence.`;
    let text="";
    try { ({text}=await sendChatMessage({providerId,apiKey,model,messages:[{role:"user",content:prompt,attachments: state.screenshotBase64 ? [{name:"page.jpg",mimeType:"image/jpeg",dataUrl:`data:image/jpeg;base64,${state.screenshotBase64}`}]:[]}]})); }
    catch(e){ throw new Error(`Browser AI failed: ${e instanceof Error?e.message:String(e)}`); }
    const d=parseFirstJson<BrowserDecision>(text);
    if(!d?.action){ parseFailures++; hint="Return exactly one JSON object."; if(parseFailures>=3) throw new Error("Browser agent returned invalid actions repeatedly."); continue; }
    parseFailures=0; hint="";
    if(d.action==='done') return {summary:d.summary||collected.join("\n")||"Browser task completed.",liveUrl:session.liveUrl,sessionId:session.sessionId};
    if(d.action==='fail') return {summary:`Could not complete the browser task: ${d.reason||"unknown reason"}.`,liveUrl:session.liveUrl,sessionId:session.sessionId};
    let action: BrowserAction|null=null, label=d.action;
    if(d.action==='search'&&d.query) action={type:'search',query:d.query,engine:d.engine};
    else if(d.action==='goto'&&d.url) action={type:'goto',url:d.url};
    else if(d.action==='click_element'&&typeof d.index==='number'){const el=(state.elements||[]).find(e=>e.index===d.index); if(el){action={type:'click',x:el.x,y:el.y};label=`click [${el.index}] ${el.label}`;}else hint=`Element ${d.index} is not visible; choose a listed element.`;}
    else if(d.action==='click'&&typeof d.x==='number'&&typeof d.y==='number') action={type:'click',x:Math.round(d.x),y:Math.round(d.y)};
    else if(d.action==='type'&&typeof d.text==='string') action={type:'type',text:d.text,submit:!!d.submit,clear:!!d.clear};
    else if(d.action==='key'&&d.key) action={type:'key',key:d.key};
    else if(d.action==='scroll') action={type:'scroll',amount:Number(d.amount)||600};
    else if(d.action==='back') action={type:'back'};
    else if(d.action==='extractText') action={type:'extractText'};
    else if(d.action==='wait') action={type:'wait',ms:Number(d.ms)||1000};
    if(!action){actionErrors++; if(actionErrors>=5) throw new Error("Browser agent produced unusable actions repeatedly."); continue;}
    const sig=`${label}@${state.url}`; repeats=sig===lastSig?repeats+1:0; lastSig=sig; if(repeats>=4) throw new Error(`Browser became stuck repeating: ${label}`);
    await onStep?.(`🌐 Step ${step+1}: ${label}`);
    try { const r=await runBrowserAction(uid,session.sessionId,action,apiKey); state=r; actionErrors=0; history.push(`${step+1}. ${label} → ${r.title||r.url||"ok"}`); if(action.type==='extractText'&&r.text){lastExtract=r.text;collected.push(`[${r.url}] ${r.text.slice(0,2500)}`);} else lastExtract=""; }
    catch(e){ actionErrors++; hint=`Last action failed: ${e instanceof Error?e.message:String(e)}. Try another approach.`; if(actionErrors>=3) throw e; state=await runBrowserAction(uid,session.sessionId,{type:'screenshot'},apiKey).catch(()=>state); }
  }
  throw new Error("Browser task reached the safety step limit without verified completion.");
}
