import { sendChatMessage } from "@/lib/chatClient";
import { parseFirstJson } from "@/lib/agentJson";
import { startComputer, runComputerAction, type ComputerAction } from "@/lib/computerUse";
import { signPreviewToken } from "@/lib/previewToken";

function mime(base64:string){return base64.startsWith("/9j/")?"image/jpeg":base64.startsWith("UklGR")?"image/webp":"image/png";}

export async function runServerComputerTask(uid:string, providerId:string, providerKey:string, task:string, model?:string, onStep?:(s:string)=>Promise<void>|void, onReady?:(liveUrl:string,sandboxId:string)=>Promise<void>|void){
  const started=await startComputer(providerKey,{uid,scope:"primary"});
  const liveUrl=`/api/preview/${signPreviewToken({uid,sandboxId:started.sandboxId,port:6080},6*60*60*1000)}/vnc.html?autoconnect=true&resize=remote&reconnect=true`;
  await onReady?.(liveUrl, started.sandboxId);
  let shot=await runComputerAction(started.sandboxId,providerKey,{type:"screenshot"});
  let history:string[]=[]; let hint=""; let parseFailures=0; let actionErrors=0; let last=""; let repeats=0;
  for(let step=0;step<35;step++){
    const b64=shot.screenshotBase64;
    const prompt=`You control a real persistent Linux desktop. Complete this task for real: "${task}"\n\nScreenshot is the current desktop. Choose ONE next action.\nHISTORY: ${history.slice(-10).join("\n")||"none"}\n${hint?`NOTE: ${hint}`:""}\nReturn ONLY JSON: click(x,y), double_click(x,y), right_click(x,y), drag(x1,y1,x2,y2), type(text), key(key), hotkey(keys), scroll(x,y,direction,amount), launch(command), wait(ms), done(summary), fail(reason).\nVerify each action using the next screenshot. Never claim done without visible evidence.`;
    let text=""; try{({text}=await sendChatMessage({providerId,apiKey:providerKey,model,messages:[{role:"user",content:prompt,attachments:[{name:"screen.png",mimeType:mime(b64),dataUrl:`data:${mime(b64)};base64,${b64}`}]}]}));}catch(e){throw new Error(`Computer AI failed: ${e instanceof Error?e.message:String(e)}`);}
    const d:any=parseFirstJson(text); if(!d?.action){parseFailures++;hint="Return exactly one JSON object.";if(parseFailures>=3)throw new Error("Computer agent returned invalid actions repeatedly.");continue;} parseFailures=0;hint="";
    if(d.action==='done') return {summary:d.summary||"Computer task completed.",sandboxId:started.sandboxId,liveUrl};
    if(d.action==='fail') return {summary:`Could not complete the computer task: ${d.reason||"unknown reason"}.`,sandboxId:started.sandboxId,liveUrl};
    let a:ComputerAction|null=null,label=d.action; const n=(v:any)=>Math.round(Number(v)||0);
    if(d.action==='click'&&d.x!==undefined&&d.y!==undefined)a={type:'click',x:n(d.x),y:n(d.y)};
    else if(d.action==='double_click'&&d.x!==undefined&&d.y!==undefined)a={type:'click',x:n(d.x),y:n(d.y),double:true};
    else if(d.action==='right_click'&&d.x!==undefined&&d.y!==undefined)a={type:'click',x:n(d.x),y:n(d.y),button:'right'};
    else if(d.action==='drag')a={type:'drag',x1:n(d.x1),y1:n(d.y1),x2:n(d.x2),y2:n(d.y2)};
    else if(d.action==='type'&&typeof d.text==='string')a={type:'type',text:d.text};
    else if(d.action==='key'&&d.key)a={type:'key',key:d.key};
    else if(d.action==='hotkey'&&d.keys)a={type:'hotkey',keys:d.keys};
    else if(d.action==='scroll')a={type:'scroll',x:d.x,y:d.y,direction:d.direction==='up'?'up':'down',amount:Math.max(1,Math.min(10,Math.abs(n(d.amount)||5)))};
    else if(d.action==='launch'&&d.command)a={type:'launch',command:d.command};
    else if(d.action==='wait')a={type:'wait',ms:Math.min(5000,Math.max(100,Number(d.ms)||1000))};
    if(!a){actionErrors++;if(actionErrors>=5)throw new Error("Computer agent produced unusable actions repeatedly.");continue;}
    const sig=JSON.stringify(a);repeats=sig===last?repeats+1:0;last=sig;if(repeats>=4)throw new Error(`Computer became stuck repeating: ${label}`);
    await onStep?.(`🖥️ Step ${step+1}: ${label}`);
    try{shot=await runComputerAction(started.sandboxId,providerKey,a);actionErrors=0;history.push(`${step+1}. ${label}`);}catch(e){actionErrors++;hint=`Last desktop action failed: ${e instanceof Error?e.message:String(e)}. Try another approach.`;if(actionErrors>=3)throw e;shot=await runComputerAction(started.sandboxId,providerKey,{type:'screenshot'}).catch(()=>shot);}
  }
  throw new Error("Computer task reached the safety step limit without verified completion.");
}
