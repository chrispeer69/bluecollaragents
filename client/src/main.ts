import { mountBooking } from "./booking";
import { createIcons, Check, Mic, MicOff, Phone, PhoneOff, RotateCcw, ShieldCheck, X } from "lucide";
import { type BotLLMTextData, type Participant, PipecatClient, type TranscriptData, type TransportState } from "@pipecat-ai/client-js";
import { WebSocketTransport } from "@pipecat-ai/websocket-transport";
import "./styles.css";
import "./experience.css";
import { mountPlatform } from "./platform";

type Speaker = "caller" | "agent" | "system";
type ProductionScenario={key:string;label:string;decision:string;offerPolicy:string;issue:string;destination:string;partner:string};
const productionScenarios:ProductionScenario[]=[
 {key:"competitor_repair",label:"Competitor repair",decision:"Flip pitch",offerPolicy:"Offer + one follow-up",issue:"Check-engine light and loss of power",destination:"Firestone on Main Street",partner:"Wayne's Westerville · 2 miles"},
 {key:"auto_body",label:"Auto body / collision",decision:"No mechanical flip",offerPolicy:"Body-shop estimate review only",issue:"Collision damage",destination:"Caliber Collision",partner:"Alpha Collision East / West"},
 {key:"residence",label:"Residence",decision:"No flip pitch",offerPolicy:"Confirmation + app close",issue:"Check-engine light and loss of power",destination:"Customer’s home",partner:"None"},
 {key:"unknown",label:"Unknown destination",decision:"No flip pitch",offerPolicy:"Confirmation + app close",issue:"Check-engine light and loss of power",destination:"Destination on file",partner:"None"},
 {key:"our_shop",label:"Our shop",decision:"No flip needed",offerPolicy:"VIP welcome",issue:"Check-engine light and loss of power",destination:"Wayne's Westerville",partner:"Already our shop"},
];
const voices = [
  ["aura-2-luna-en", "Luna", "Warm, conversational"],
  ["aura-2-athena-en", "Athena", "Clear, professional"],
  ["aura-2-thalia-en", "Thalia", "Confident, direct"],
  ["aura-2-orion-en", "Orion", "Male, approachable"],
  ["aura-2-asteria-en", "Asteria", "Female, expressive"],
  ["flux-haley-en", "Haley (Flux)", "American female, calm and professional"],
  ["flux-paige-en", "Paige (Flux)", "American female, caring and comfortable"],
];

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("App root is missing");
app.innerHTML = `
<main class="shell">
  <header class="topbar"><div class="brand"><div class="brand-mark" aria-hidden="true"><svg viewBox="0 0 48 48"><defs><linearGradient id="bca-logo-gradient" x1="8" y1="8" x2="40" y2="40"><stop stop-color="#72d8f4"/><stop offset=".52" stop-color="#9c7cf1"/><stop offset="1" stop-color="#df75c9"/></linearGradient></defs><rect x="2" y="2" width="44" height="44" rx="13" fill="#17131f"/><path d="M12 25v-2M18 31V17M24 36V12M30 32V16M36 27v-6" fill="none" stroke="url(#bca-logo-gradient)" stroke-width="4.2" stroke-linecap="round"/></svg></div><div><strong>Blue Collar Agents</strong><span>VOICE AI FOR THE REAL WORLD</span></div></div><div class="header-actions"><a href="#voice-demo">Try the agent</a><div id="sales-action"></div></div></header>
  <section class="hero"><div><p class="eyebrow">ALWAYS ON. ALWAYS READY.</p><h1>Your next great hire<br />is <em>already online.</em></h1><p class="lede">Voice AI for the businesses that keep the world moving. Meet Agent—try a live conversation and hear what’s possible.</p></div>
    <aside class="setup-card"><label>Language model<select id="model"><option value="claude-sonnet-4-6">Claude Sonnet 4.6 — highest quality</option><option value="claude-haiku-4-5-20251001">Claude Haiku 4.5 — lower cost</option></select></label><label>Voice under test<select id="voice">${voices.map(([id,name,note]) => `<option value="${id}">${name} — ${note}</option>`).join("")}</select></label><div><span>Agent</span><strong>Agent · Compact outbound prompt</strong><small>Token-reduced equivalent with editable call script</small></div></aside>
  </section>
  <section class="scenario-picker"><div><label><span>Production scenario</span><select id="production-scenario">${productionScenarios.map(s=>`<option value="${s.key}">${s.label}</option>`).join("")}</select></label><p>Rendered by the real <code>us-tow-ai-connect</code> slim script engine.</p></div><div class="route-summary"><div><b>Flip Engine decision</b><span id="route-decision">Flip pitch</span></div><div><b>Offer policy</b><span id="route-policy">Offer + one follow-up</span></div></div></section>
  <section id="voice-demo" class="console" aria-label="Live voice agent demo">
    <div class="call-panel"><div class="status-row"><div><span id="status-dot" class="dot"></span><strong id="status">Agent is ready</strong></div><time id="timer">00:00</time></div><div id="orb" class="orb" data-state="idle" aria-hidden="true"><div class="blob-halo"></div><div class="orb-core"><div class="blob-inner"></div></div><div class="blob-satellite"></div></div><p id="activity" class="activity" role="status">Answer the call — Agent speaks first</p><div class="controls"><button id="connect" class="primary"><i data-lucide="phone"></i><span>Talk to Agent</span></button><button id="mute" class="round" disabled><i data-lucide="mic"></i></button><button id="disconnect" class="round danger" disabled><i data-lucide="phone-off"></i></button></div><audio id="bot-audio" autoplay></audio></div>
    <div class="transcript-panel"><div class="panel-heading"><div><span>Live transcript</span><small id="message-count">No messages yet</small></div><button id="clear"><i data-lucide="rotate-ccw"></i> Clear</button></div><div id="transcript" class="transcript" role="log" aria-label="Live conversation" aria-live="polite" aria-relevant="additions text"><div class="empty-state"><span>Your conversation, as it happens.</span><small>Start a call. Speak naturally. Interrupt anytime.</small></div></div></div>
  </section>
  <section class="metrics-card live-metrics"><span>Run metrics</span><div class="metric-grid"><div><strong id="duration">0:00</strong><small>Duration</small></div><div><strong id="latency">—</strong><small>Response latency</small></div><div><strong id="turns">0</strong><small>Caller turns</small></div><div><strong id="tokens">0 / 0</strong><small>LLM input / output tokens</small></div><div><strong id="stt-cost">$0.0000</strong><small>STT cost</small></div><div><strong id="tts-cost">$0.0000</strong><small>TTS cost</small></div><div><strong id="llm-cost">$0.0000</strong><small>LLM cost</small></div><div><strong id="cost">$0.0000</strong><small>Total call cost</small></div></div><p>Token counts and speech usage come from provider-reported Pipecat metrics. Dollar amounts use configured model rates; provider invoices remain the billing source of truth.</p></section>
  <section id="payload" class="payload-card"><span>Production-style call inputs</span><div><b>Customer</b> Pat Morgan</div><div><b>Vehicle</b> 2017 Ford Escape</div><div><b>Pickup</b> I-70 eastbound near exit 101</div><div><b>Destination</b> <span id="payload-destination">Firestone on Main Street</span></div><div><b>Issue</b> <span id="payload-issue">Check-engine light and loss of power</span></div><div><b>Partner shop</b> <span id="payload-partner">Wayne's Westerville · 2 miles</span></div><p>Sanitized compact fixture derived from the production v3.16 script. No tenant database or customer record is accessed.</p></section>
  <section id="prompt-studio" class="prompt-studio"><div class="studio-head"><div><span>Prompt studio</span><strong>What the model receives</strong></div><button id="reset-prompts">Reset compact copies</button></div><div class="editor-tabs"><button data-editor="agent" class="selected">Agent prompt</button><button data-editor="script">Call script_body</button><button data-editor="builder">Agent builder config</button></div><div class="editor-pane" data-pane="agent"><div class="editor-meta"><span>Fixed behavior and delivery rules</span><small id="agent-count">Loading…</small></div><textarea id="agent-prompt" spellcheck="false"></textarea></div><div class="editor-pane" data-pane="script" hidden><div class="editor-meta"><span>Tenant/job-specific rendered conversation</span><small id="script-count">Loading…</small></div><textarea id="script-body" spellcheck="false"></textarea></div><div class="editor-pane" data-pane="builder" hidden><div class="editor-meta"><span>Current Agent Script Builder configuration (two-offer flow)</span><small id="builder-count">Loading…</small></div><textarea id="builder-config" spellcheck="false"></textarea></div><p>Agent prompt and Call script_body edits apply to the next test call. The builder config is an editable two-offer reference saved with the run; copy rendered changes into Call script_body to test them. Keep <code>{{script_body}}</code> in the agent prompt.</p></section>
  <section class="results">
    <div class="score-card"><div><span>Run verdict</span><strong id="verdict">Not scored</strong></div><div class="verdict-buttons"><button id="pass"><i data-lucide="check"></i> Pass</button><button id="fail"><i data-lucide="x"></i> Fail</button></div><label>Notes<textarea id="notes" placeholder="What worked or failed?"></textarea></label><button id="save-run" class="save-run">Save test run</button></div>
    <div class="check-card"><span>Production flow checks</span><ul id="checks"><li><input type="checkbox"> <span>Agent identifies itself as AI</span></li><li><input type="checkbox"> <span>Asks one question at a time</span></li><li><input type="checkbox"> <span>Handles corrections and interruptions</span></li><li><input type="checkbox"> <span>Never claims real actions were completed</span></li></ul></div>
  </section>
  <section class="history-card"><div><span>Saved comparisons</span><button id="clear-history">Clear history</button></div><div class="history-wrap"><table><thead><tr><th>Date</th><th>Direction / route</th><th>Model</th><th>Voice</th><th>Duration</th><th>Latency</th><th>Cost</th><th>Result</th><th>Variant</th></tr></thead><tbody id="history"></tbody></table></div><p id="history-empty">No saved runs yet. Complete a call, score it, and save it.</p></section>
</main>`;
createIcons({ icons: { Check, Mic, MicOff, Phone, PhoneOff, RotateCcw, ShieldCheck, X } });

const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const connectButton=byId<HTMLButtonElement>("connect"), disconnectButton=byId<HTMLButtonElement>("disconnect"), muteButton=byId<HTMLButtonElement>("mute"), clearButton=byId<HTMLButtonElement>("clear"), voiceSelect=byId<HTMLSelectElement>("voice"), modelSelect=byId<HTMLSelectElement>("model"), scenarioSelect=byId<HTMLSelectElement>("production-scenario");
const status=byId("status"), statusDot=byId("status-dot"), activity=byId("activity"), transcript=byId("transcript"), messageCount=byId("message-count"), timer=byId("timer"), orb=byId("orb"), botAudio=byId<HTMLAudioElement>("bot-audio");
const agentPrompt=byId<HTMLTextAreaElement>("agent-prompt"), scriptBody=byId<HTMLTextAreaElement>("script-body"), builderConfig=byId<HTMLTextAreaElement>("builder-config");
let callAttempt=0;
let startRequest:AbortController|undefined;
let leavingCall=false;
let serverEndMessage="";
let activeAgentName="Voice assistant";
const rawDemoToken=new URLSearchParams(location.search).get('demo');
const demoToken=rawDemoToken?.replace(/\/+$/,'')||null;
let demoMaxSeconds=900;
let userRequestedDisconnect=false, callFailure="", agentHasSpoken=false;
let startedAt=0, timerHandle:number|undefined, messages=0, muted=false, partialAgentMessage:HTMLDivElement|null=null, partialCallerMessage:HTMLDivElement|null=null, callerChars=0, agentChars=0, callerTurns=0, waitingSince=0, latencyTotal=0, latencySamples=0, verdict="Not scored";
let llmInputTokens=0,llmOutputTokens=0,llmCacheReadTokens=0,llmCacheWriteTokens=0,ttsCharacters=0,sttAudioSeconds=0,awaitingOpening=false;
let productionPrompt="",productionScript="",productionBuilder="",activeScenarioKey="competitor_repair";

function setStatus(label:string,state:"idle"|"busy"|"live"|"error"="idle"){status.textContent=label;statusDot.dataset.state=state;orb.dataset.connection=state;if(state!=="live")orb.dataset.state=state==="busy"?"connecting":"idle"}
function setActivity(label:string,speaking=false){activity.textContent=label;orb.classList.toggle("speaking",speaking);orb.dataset.state=orb.dataset.connection!=="live"?"idle":label.includes("thinking")?"thinking":label.includes("muted")?"muted":label.includes("speaking")?"speaking":"listening"}
function updateCount(){messageCount.textContent=messages?`${messages} message${messages===1?"":"s"}`:"No messages yet"}
function addMessage(speaker:Speaker,text:string){if(!text.trim())return;transcript.querySelector(".empty-state")?.remove();const row=document.createElement("div");row.className=`message ${speaker}`;row.innerHTML=`<span>${speaker==="caller"?"You":speaker==="agent"?activeAgentName:"Lab"}</span><p></p>`;row.querySelector("p")!.textContent=text;transcript.append(row);transcript.scrollTop=transcript.scrollHeight;messages++;updateCount();return row}
function appendCallerText(text:string){const clean=text.trim();if(!clean)return;if(!partialCallerMessage){partialCallerMessage=addMessage("caller",clean)??null;callerChars+=clean.length;callerTurns++;updateMetrics();return}const p=partialCallerMessage.querySelector("p")!;const join=/^[,.;!?]/.test(clean)?"":" ";p.textContent=(p.textContent??"")+join+clean;callerChars+=join.length+clean.length;transcript.scrollTop=transcript.scrollHeight;updateMetrics()}
function appendAgentText(text:string){const clean=text.trim();if(!clean)return;if(!partialAgentMessage){partialAgentMessage=addMessage("agent",clean)??null;agentChars+=clean.length;return}const p=partialAgentMessage.querySelector("p")!;const current=p.textContent??"";if(current===clean||current.endsWith(clean))return;if(clean.startsWith(current)){agentChars+=clean.length-current.length;p.textContent=clean}else{const join=/^[,.;!?]/.test(clean)?"":" ";p.textContent=current+join+clean;agentChars+=join.length+clean.length}transcript.scrollTop=transcript.scrollHeight}
function elapsed(){return startedAt?Math.floor((Date.now()-startedAt)/1000):0}
function modelRates(){return modelSelect.value.includes("haiku")?{input:1,output:5,cacheRead:.1,cacheWrite:1.25}:{input:3,output:15,cacheRead:.3,cacheWrite:3.75}}
function updateMetrics(){const sec=elapsed();byId("duration").textContent=`${Math.floor(sec/60)}:${String(sec%60).padStart(2,"0")}`;byId("turns").textContent=String(callerTurns);byId("latency").textContent=latencySamples?`${(latencyTotal/latencySamples/1000).toFixed(1)}s`:"—";const rates=modelRates(),stt=(sttAudioSeconds||sec)/60*0.0048,tts=(ttsCharacters||agentChars)/1000*0.03,llm=(llmInputTokens*rates.input+llmOutputTokens*rates.output+llmCacheReadTokens*rates.cacheRead+llmCacheWriteTokens*rates.cacheWrite)/1_000_000;byId("tokens").textContent=`${llmInputTokens.toLocaleString()} / ${llmOutputTokens.toLocaleString()}`;byId("stt-cost").textContent=`$${stt.toFixed(4)}`;byId("tts-cost").textContent=`$${tts.toFixed(4)}`;byId("llm-cost").textContent=`$${llm.toFixed(4)}`;byId("cost").textContent=`$${(stt+tts+llm).toFixed(4)}`}
function startTimer(){startedAt=Date.now();timerHandle=window.setInterval(()=>{const s=elapsed(),limit=`${String(Math.floor(demoMaxSeconds/60)).padStart(2,"0")}:${String(demoMaxSeconds%60).padStart(2,"0")}`;timer.textContent=`${String(Math.floor(s/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")} / ${limit}`;updateMetrics()},500)}
function stopTimer(){if(timerHandle)clearInterval(timerHandle);timerHandle=undefined;updateMetrics()}
async function initializeMicrophone(){
 if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia)throw new DOMException('Microphone access requires a secure HTTPS page.','SecurityError');
 let timeout:number|undefined;
 try{
  await Promise.race([
   client.initDevices(),
   new Promise<never>((_,reject)=>{timeout=window.setTimeout(()=>reject(new DOMException('Microphone permission timed out.','TimeoutError')),15000)}),
  ]);
 }finally{if(timeout)window.clearTimeout(timeout)}
}
const client=new PipecatClient({transport:new WebSocketTransport(),enableMic:true,enableCam:false,callbacks:{
 onTransportStateChanged:(s:TransportState)=>{if(s==="connecting")setStatus("Connecting","busy")},
 onConnected:()=>{if(leavingCall){void client.disconnect();return;}awaitingOpening=true;void client.enableMic(false);setStatus(`${activeAgentName} is opening the call`,"live");setActivity("Please wait for the greeting",true);connectButton.disabled=true;disconnectButton.disabled=false;muteButton.disabled=true;voiceSelect.disabled=true;modelSelect.disabled=true;scenarioSelect.disabled=true;startTimer()},
 onDisconnected:()=>{byId<HTMLSelectElement>("demo-agent").disabled=false;transcript.querySelector(".interim-message")?.remove();
   if(serverEndMessage){setStatus("Demo ended");setActivity(serverEndMessage)}
   else if(userRequestedDisconnect){setStatus("Call ended");setActivity("Ready for another conversation?")}
   else{setStatus(agentHasSpoken?"Connection lost":"Could not start call","error");setActivity(callFailure || (agentHasSpoken?"The connection closed unexpectedly. Check the agent server and try again.":"The agent disconnected before speaking. Check the backend and its API keys."))}
   connectButton.disabled=false;disconnectButton.disabled=true;muteButton.disabled=true;voiceSelect.disabled=false;modelSelect.disabled=false;scenarioSelect.disabled=false;stopTimer()},
 onUserStartedSpeaking:()=>{if(!awaitingOpening)setActivity("Listening to you",true)},
 onUserStoppedSpeaking:()=>{waitingSince=Date.now();setActivity("Thinking…")},
 onBotStartedSpeaking:()=>{agentHasSpoken=true;partialCallerMessage=null;if(waitingSince){latencyTotal+=Date.now()-waitingSince;latencySamples++;waitingSince=0;updateMetrics()}setActivity("Agent is speaking",true)},
 onBotStoppedSpeaking:()=>{partialAgentMessage=null;if(awaitingOpening){awaitingOpening=false;void client.enableMic(true);muteButton.disabled=false;setStatus("Live conversation","live");setActivity("Your turn — listening")}else setActivity("Listening")},
 onUserTranscript:(d:TranscriptData)=>{
   transcript.querySelector(".interim-message")?.remove();
   if(d.final){appendCallerText(d.text);return;}
   if(!d.text.trim())return;
   transcript.querySelector(".empty-state")?.remove();
   const row=document.createElement("div");row.className="message caller interim-message";
   row.innerHTML='<span>You · speaking</span><p></p>';
   row.querySelector("p")!.textContent=d.text;transcript.append(row);transcript.scrollTop=transcript.scrollHeight;
 },
 onBotTranscript:(d:BotLLMTextData)=>appendAgentText(d.text),
 onServerMessage:(d:any)=>{if(d?.type==="call_ending"){serverEndMessage=String(d.text||"Demo limit reached.");setStatus("Demo ending");setActivity(serverEndMessage);addMessage("system",serverEndMessage);return;}if(d?.type==="opening"){if(d.voice)voiceSelect.value=d.voice;if(d.model)modelSelect.value=d.model;addMessage("agent",String(d.text||""));return}if(d?.type!=="usage")return;if(d.service==="llm"){llmInputTokens+=Number(d.input_tokens||0);llmOutputTokens+=Number(d.output_tokens||0);llmCacheReadTokens+=Number(d.cache_read_tokens||0);llmCacheWriteTokens+=Number(d.cache_write_tokens||0)}else if(d.service==="tts")ttsCharacters+=Number(d.characters||0);else if(d.service==="stt")sttAudioSeconds+=Number(d.audio_seconds||0);updateMetrics()},
 onTrackStarted:(track:MediaStreamTrack,p?:Participant)=>{if(!p?.local&&track.kind==="audio")botAudio.srcObject=new MediaStream([track])},
 onError:(e)=>{console.error(e);callFailure="Voice connection failed. Check the agent server and its API keys.";setStatus("Connection error","error");setActivity(callFailure)}
}});
connectButton.addEventListener("click",async()=>{const attempt=++callAttempt;leavingCall=false;startRequest=new AbortController();const picker=byId<HTMLSelectElement>("demo-agent");activeAgentName=picker.selectedOptions[0]?.textContent||"Voice assistant";clearButton.click();picker.disabled=true;userRequestedDisconnect=false;serverEndMessage="";callFailure="";agentHasSpoken=false;llmInputTokens=llmOutputTokens=llmCacheReadTokens=llmCacheWriteTokens=ttsCharacters=sttAudioSeconds=0;callerChars=agentChars=callerTurns=latencyTotal=latencySamples=0;updateMetrics();connectButton.disabled=true;setStatus("Requesting microphone","busy");window.dispatchEvent(new CustomEvent("voice-call-starting",{detail:{agentName:activeAgentName}}));try{await initializeMicrophone();if(attempt!==callAttempt)return;setStatus("Starting voice session","busy");const base=(import.meta.env.VITE_AGENT_URL||"").replace(/\/$/,"");const response=await fetch(`${base}/lab/start`,{signal:startRequest.signal,method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({body:{agent_id:byId<HTMLSelectElement>("demo-agent").value,demo_token:demoToken}})});const connection=await response.json();if(attempt!==callAttempt)return;if(!response.ok){callFailure=typeof connection.detail==="string"?connection.detail:"Unable to start this demo.";throw new Error(callFailure);}const wsUrl=connection.ws_url||connection.wsUrl;if(typeof wsUrl!=="string")throw new Error("Voice server returned no WebSocket URL");await client.connect({ws_url:wsUrl})}catch(e){if(attempt!==callAttempt)return;console.error(e);setStatus("Could not connect","error");if(e instanceof DOMException){if(e.name==="NotAllowedError")callFailure="Microphone access is blocked. Allow it in your browser's site settings, then retry.";else if(e.name==="NotFoundError")callFailure="No microphone was found. Connect or enable a microphone, then retry.";else if(e.name==="SecurityError")callFailure="Microphone access requires the secure HTTPS site.";else if(e.name==="TimeoutError")callFailure="The browser did not finish microphone permission. Allow microphone access in the address bar, then retry."}callFailure=callFailure||"Could not connect to the voice agent. Check that the backend is running, then retry.";setActivity(callFailure);connectButton.disabled=false;byId<HTMLSelectElement>("demo-agent").disabled=false}});
disconnectButton.addEventListener("click",()=>{userRequestedDisconnect=true;void client.disconnect()});
muteButton.addEventListener("click",async()=>{muted=!muted;await client.enableMic(!muted);muteButton.innerHTML=`<i data-lucide="${muted?"mic-off":"mic"}"></i>`;createIcons({icons:{Mic,MicOff}});setActivity(muted?"Microphone muted":"Listening")});
clearButton.addEventListener("click",()=>{transcript.innerHTML='<div class="empty-state"><span>Your conversation, as it happens.</span><small>Start a call. Speak naturally. Interrupt anytime.</small></div>';messages=callerChars=agentChars=callerTurns=latencyTotal=latencySamples=0;llmInputTokens=llmOutputTokens=llmCacheReadTokens=llmCacheWriteTokens=ttsCharacters=sttAudioSeconds=0;partialAgentMessage=partialCallerMessage=null;updateCount();updateMetrics()});
byId("pass").addEventListener("click",()=>{verdict="Passed";byId("verdict").textContent=verdict;byId("verdict").className="passed"});
byId("fail").addEventListener("click",()=>{verdict="Failed";byId("verdict").textContent=verdict;byId("verdict").className="failed"});

type SavedRun={id:string;date:string;mode:string;scenario:string;model:string;voice:string;duration:string;latency:string;cost:string;verdict:string;notes:string;transcript:string;agentPrompt?:string;scriptBody?:string;builderConfig?:string};
const historyKey="tow-agent-lab-runs-v1";
function loadRuns():SavedRun[]{try{return JSON.parse(localStorage.getItem(historyKey)||"[]")}catch{return[]}}
function renderHistory(){const runs=loadRuns(),body=byId("history");body.textContent="";for(const r of runs){const row=document.createElement("tr");for(const value of [new Date(r.date).toLocaleString(),`${r.mode} / ${r.scenario}`,r.model.replace("claude-",""),voices.find(v=>v[0]===r.voice)?.[1]||r.voice,r.duration,r.latency,r.cost,r.verdict]){const cell=document.createElement("td");cell.textContent=value;row.append(cell)};row.children[7]?.classList.add(r.verdict.toLowerCase());const action=document.createElement("td");if(r.agentPrompt&&r.scriptBody){const load=document.createElement("button");load.textContent="Load";load.addEventListener("click",()=>{modelSelect.value=r.model;voiceSelect.value=r.voice;agentPrompt.value=r.agentPrompt!;scriptBody.value=r.scriptBody!;if(r.builderConfig)builderConfig.value=r.builderConfig;updateEditorCounts();window.scrollTo({top:byId("prompt-studio").offsetTop-20,behavior:"smooth"})});action.append(load)}row.append(action);body.append(row)}byId("history-empty").hidden=runs.length>0}
byId("save-run").addEventListener("click",()=>{const run:SavedRun={id:crypto.randomUUID(),date:new Date().toISOString(),mode:activeAgentName,scenario:byId<HTMLSelectElement>("demo-agent").value,model:modelSelect.value,voice:voiceSelect.value,duration:byId("duration").textContent||"0:00",latency:byId("latency").textContent||"—",cost:byId("cost").textContent||"$0.000",verdict,notes:byId<HTMLTextAreaElement>("notes").value,transcript:Array.from(transcript.querySelectorAll(".message")).map(row=>`${row.querySelector("span")?.textContent}: ${row.querySelector("p")?.textContent}`).join("\n"),};const runs=loadRuns();runs.unshift(run);localStorage.setItem(historyKey,JSON.stringify(runs.slice(0,20)));renderHistory();byId("save-run").textContent="Saved"});
byId("clear-history").addEventListener("click",()=>{localStorage.removeItem(historyKey);renderHistory()});
renderHistory();
function updateEditorCounts(){byId("agent-count").textContent=`${agentPrompt.value.length.toLocaleString()} characters`;byId("script-count").textContent=`${scriptBody.value.length.toLocaleString()} characters`;byId("builder-count").textContent=`${builderConfig.value.length.toLocaleString()} characters`}
async function loadProductionCopies(){const [prompt,script,builder]=await Promise.all([fetch("/emily-outbound.txt").then(r=>r.text()),fetch(`/scenario-${activeScenarioKey}.txt`).then(r=>r.text()),fetch("/tenant-script-builder-config.txt").then(r=>r.text())]);productionPrompt=prompt;productionScript=script;productionBuilder=builder;agentPrompt.value=prompt;scriptBody.value=script;builderConfig.value=builder;updateEditorCounts()}
async function selectProductionScenario(key:string){const selected=productionScenarios.find(s=>s.key===key);if(!selected)return;activeScenarioKey=key;productionScript=await fetch(`/scenario-${key}.txt`).then(r=>r.text());scriptBody.value=productionScript;byId("route-decision").textContent=selected.decision;byId("route-policy").textContent=selected.offerPolicy;byId("payload-issue").textContent=selected.issue;byId("payload-destination").textContent=selected.destination;byId("payload-partner").textContent=selected.partner;updateEditorCounts()}
scenarioSelect.addEventListener("change",()=>void selectProductionScenario(scenarioSelect.value));
// Public calls use backend-managed scripts; do not load legacy prompt fixtures.
agentPrompt.addEventListener("input",updateEditorCounts);scriptBody.addEventListener("input",updateEditorCounts);builderConfig.addEventListener("input",updateEditorCounts);
byId("reset-prompts").addEventListener("click",()=>{agentPrompt.value=productionPrompt;scriptBody.value=productionScript;builderConfig.value=productionBuilder;updateEditorCounts()});
document.querySelectorAll<HTMLElement>("[data-editor]").forEach(button=>button.addEventListener("click",()=>{const target=button.dataset.editor;document.querySelectorAll<HTMLElement>("[data-editor]").forEach(b=>b.classList.toggle("selected",b===button));document.querySelectorAll<HTMLElement>("[data-pane]").forEach(p=>p.hidden=p.dataset.pane!==target)}));

mountBooking(byId("sales-action"));
// Move existing controls, keeping their DOM nodes and event handlers intact.
const advanced = document.createElement("details");
advanced.className = "demo-settings";
advanced.innerHTML = '<summary>Demo settings & call diagnostics <span>Metrics and saved runs</span></summary>';
const settingsBody = document.createElement("div");
settingsBody.className = "demo-settings-body";
for (const selector of [".setup-card", ".scenario-picker", ".live-metrics", ".payload-card", ".prompt-studio", ".results", ".history-card"]) {
  const section = document.querySelector(selector);
  if(section) settingsBody.append(section);
}
advanced.append(settingsBody);
document.querySelector(".shell")!.append(advanced);
const demoLabel = document.createElement("div");
demoLabel.className = "demo-intro";
demoLabel.innerHTML = '<div><span class="demo-live-dot"></span> LIVE AGENT DEMO <span class="demo-intro-muted">/ Interactive voice demo</span></div><span>Simulated conversation · No real actions</span>';
byId("voice-demo").before(demoLabel);
const footer = document.createElement("footer");
footer.className = "experience-footer";
footer.innerHTML = '<strong>Built for the people who build everything.</strong><span>Blue Collar Agents · Voice AI, on your team.</span>';
document.querySelector(".shell")!.append(footer);

mountPlatform(async()=>{
 leavingCall=true;
 callAttempt++;
 startRequest?.abort();
 userRequestedDisconnect=true;
 await client.disconnect();
 connectButton.disabled=false;
 byId<HTMLSelectElement>('demo-agent').disabled=false;
});

connectButton.disabled=true;
async function loadAgentCatalog(){
 try{
  const response=await fetch(demoToken?`/api/demos/${encodeURIComponent(demoToken)}`:'/api/agents');
  if(!response.ok)throw new Error('Agent catalog unavailable');
  const payload=await response.json();
  const agents:Array<{id:string;name:string}>=demoToken?[payload.agent]:payload;
  if(demoToken){demoMaxSeconds=Math.max(60,Number(payload.remaining_minutes||1)*60);document.body.classList.add('private-demo');document.querySelector<HTMLElement>('.hero .eyebrow')!.textContent='PRIVATE VOICE AGENT TRIAL';document.querySelector<HTMLElement>('.hero h1')!.textContent=`Try ${payload.label}'s AI agent.`;document.querySelector<HTMLElement>('.hero .lede')!.textContent=`This private demo is configured for ${payload.label}. Start the call and speak naturally to experience the assigned agent.`;document.querySelector<HTMLElement>('.hero-links')!.hidden=true;document.querySelector<HTMLElement>('.mic-note')!.textContent=`${payload.remaining_minutes} trial minutes remaining · Transcript saved for review`;}
  const picker=byId<HTMLSelectElement>('demo-agent');picker.replaceChildren();
  for(const agent of agents){const option=document.createElement('option');option.value=agent.id;option.textContent=agent.name;picker.append(option);}
  picker.disabled=!agents.length;connectButton.disabled=!agents.length;
  setStatus(agents.length?'Choose an agent to start':'No demos are currently enabled');
  setActivity('Choose a demo and start a conversation');
 }catch{
  const picker=byId<HTMLSelectElement>('demo-agent');
  picker.replaceChildren(new Option('Agents unavailable — refresh to retry',''));
  picker.disabled=true;
  connectButton.disabled=true;
  setStatus('Agent catalog unavailable','error');
  if(demoToken){document.body.classList.add('private-demo');document.querySelector<HTMLElement>('.hero .eyebrow')!.textContent='PRIVATE TRIAL UNAVAILABLE';document.querySelector<HTMLElement>('.hero h1')!.textContent='This trial link is unavailable.';document.querySelector<HTMLElement>('.hero .lede')!.textContent='The link may have expired or used its allotted minutes. Contact the person who shared it for a new trial.';document.querySelector<HTMLElement>('.hero-links')!.hidden=true;setActivity('Ask the sender for a new private trial link.');}else setActivity('Start the backend, then refresh this page.');
 }
}
void loadAgentCatalog();
// Script editing now lives behind admin authentication.
for(const selector of ['.setup-card','.scenario-picker','.payload-card','.prompt-studio'])document.querySelector<HTMLElement>(selector)?.remove();
