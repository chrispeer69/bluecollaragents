import './admin.css';
type Agent = {id:string;name:string;description:string;greeting:string;prompt:string;voice:string;enabled:boolean;version:number};
const root=document.querySelector<HTMLElement>('#admin')!;
let csrf='', agents:Agent[]=[], selected:Agent|undefined, dirty=false;
root.innerHTML=`<header><a href="./">Blue Collar Agents ↗</a><span>AGENT ADMIN</span><button id="logout" hidden>Sign out</button></header><p id="notice" role="status"></p><section id="setup" hidden><p class="eyebrow">FIRST-TIME ADMIN SETUP</p><h1>Set up your admin login.</h1><p>Choose the credentials you will use to access this dashboard.</p><form id="setup-form"><label>Username<input name="username" required autocomplete="username" maxlength="100"></label><label>Password<input name="password" type="password" required autocomplete="new-password" minlength="8" maxlength="256"></label><label>Confirm password<input name="confirmation" type="password" required autocomplete="new-password" minlength="8" maxlength="256"></label><label>One-time setup token<input name="setup_token" type="password" required autocomplete="off" maxlength="512"></label><button>Save admin login</button></form><small>This setup appears only once. Remove or rotate <code>ADMIN_SETUP_TOKEN</code> afterward.</small></section><section id="login" hidden><p class="eyebrow">YOUR VOICE WORKSPACE</p><h1>Welcome back.</h1><p>Sign in to manage agent scripts and conversations.</p><form id="login-form"><label>Username<input name="username" required autocomplete="username" maxlength="100"></label><label>Password<input name="password" type="password" required autocomplete="current-password" maxlength="256"></label><button>Sign in</button></form></section><section id="workspace" hidden><aside><h2>Your agents</h2><button id="show-business" type="button">Business website</button><button id="show-calls" type="button">Call history</button><div id="agents"></div><a href="./">Open demo ↗</a></aside><form id="editor"><div class="editor-head"><div><p class="eyebrow">SCRIPT EDITOR</p><h1 id="heading"></h1></div><span id="version"></span></div><label>Public name<input name="name" required maxlength="80"></label><label>Description<input name="description" required maxlength="240"></label><div class="row"><label>Voice<select name="voice">${['aura-2-luna-en','aura-2-athena-en','aura-2-thalia-en','aura-2-orion-en','aura-2-asteria-en','flux-haley-en','flux-paige-en'].map(v=>`<option>${v}</option>`).join('')}</select></label><label class="check"><input type="checkbox" name="enabled"> Available in public demo</label></div><label>Opening greeting<textarea name="greeting" rows="3" required minlength="10" maxlength="1000"></textarea></label><label>Agent instructions and script<textarea name="prompt" rows="20" required minlength="100" maxlength="30000" spellcheck="false"></textarea></label><p class="hint">Saving applies to new calls. Active calls keep their starting version.</p><button id="save">Save changes</button></form></section>`;
const el=(id:string)=>document.getElementById(id)!;
const notice=(message:string)=>{el('notice').textContent=message;};
async function api(path:string,method='GET',body?:unknown){
 const response=await fetch('/api/admin/'+path,{method,credentials:'same-origin',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:body===undefined?undefined:JSON.stringify(body)});
 const data=await response.json();
 if(!response.ok){if(response.status===401){el('login').hidden=false;el('workspace').hidden=true;el('logout').hidden=true;}throw new Error(typeof data.detail==='string'?data.detail:'Request failed. Check the fields and retry.');}
 return data;
}
function select(agent:Agent){
 document.getElementById("call-history")?.remove();document.getElementById('business-profile')?.remove();el("editor").hidden=false;
 if(dirty && !confirm('Discard unsaved changes?'))return;
 selected=agent;dirty=false;
 const form=el('editor') as HTMLFormElement;
 for(const key of ['name','description','voice','greeting','prompt'] as const)(form.elements.namedItem(key) as HTMLInputElement).value=agent[key];
 (form.elements.namedItem('enabled') as HTMLInputElement).checked=agent.enabled;
 el('heading').textContent=agent.name;el('version').textContent=`Version ${agent.version}`;
 document.querySelectorAll<HTMLButtonElement>('[data-agent]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.agent===agent.id)));
}
async function load(){
 el("call-history")?.remove();el("editor").hidden=false;
 agents=await api('agents');el('login').hidden=true;el('workspace').hidden=false;el('logout').hidden=false;
 el('agents').replaceChildren();
 for(const a of agents){const b=document.createElement('button');b.type='button';b.dataset.agent=a.id;b.textContent=a.name+(a.enabled?'':' · Disabled');b.onclick=()=>select(a);el('agents').append(b);}
 select(agents.find(a=>a.id===selected?.id)??agents[0]);
}
(el('login-form') as HTMLFormElement).onsubmit=async event=>{event.preventDefault();const form=event.currentTarget as HTMLFormElement;const button=form.querySelector('button')!;button.disabled=true;try{const data=new FormData(form);const session=await api('login','POST',Object.fromEntries(data));csrf=session.csrf;form.reset();await load();notice('Signed in.');}catch(e){notice((e as Error).message);}finally{button.disabled=false;}};
(el('setup-form') as HTMLFormElement).onsubmit=async event=>{event.preventDefault();const form=event.currentTarget as HTMLFormElement;const button=form.querySelector('button')!;const data=new FormData(form);if(data.get('password')!==data.get('confirmation')){notice('Passwords do not match.');return;}button.disabled=true;try{const session=await api('setup','POST',{username:data.get('username'),password:data.get('password'),setup_token:data.get('setup_token')});csrf=session.csrf;form.reset();el('setup').hidden=true;await load();notice('Owner account created. Save the credentials securely.');}catch(e){notice((e as Error).message);}finally{button.disabled=false;}};
el('editor').addEventListener('input',()=>{dirty=true;});
(el('editor') as HTMLFormElement).onsubmit=async event=>{event.preventDefault();if(!selected)return;const button=el('save') as HTMLButtonElement;button.disabled=true;try{const form=event.currentTarget as HTMLFormElement;const fields=Object.fromEntries(new FormData(form));const updated=await api('agents/'+selected.id,'PUT',{...fields,enabled:(form.elements.namedItem('enabled') as HTMLInputElement).checked,version:selected.version});dirty=false;selected=updated;await load();notice('Saved. New calls will use version '+updated.version+'.');}catch(e){notice((e as Error).message);}finally{button.disabled=false;}};
el('logout').onclick=async()=>{if(dirty&&!confirm('Discard unsaved changes and sign out?'))return;try{await api('logout','POST');dirty=false;csrf='';location.reload();}catch(e){notice((e as Error).message);}};
window.addEventListener('beforeunload',event=>{if(dirty){event.preventDefault();event.returnValue='';}});
async function start(){try{const session=await api('session');csrf=session.csrf;await load();}catch{try{const status=await api('status');el('setup').hidden=!status.needs_setup;el('login').hidden=status.needs_setup;if(status.needs_setup&&!status.setup_available)notice('Set ADMIN_SETUP_TOKEN on the server, restart it, then refresh this page.');}catch{el('login').hidden=false;notice('The admin backend is unavailable. Start the server and refresh.');}}}
void start();

let callOffset=0;
async function showCalls(){
 if(dirty&&!confirm('Discard unsaved script changes?'))return;
 dirty=false;el('editor').hidden=true;document.getElementById('business-profile')?.remove();
 document.getElementById('call-history')?.remove();
 const panel=document.createElement('section');panel.id='call-history';
 panel.innerHTML='<h1>Call history</h1><p class="hint">Server transcripts · No audio recordings. Agent text may include generated speech interrupted before playback.</p><div id="call-list"></div><div class="history-pager"><button id="calls-prev">← Newer</button><button id="calls-next">Older →</button></div><div id="call-detail"></div>';
 el('workspace').append(panel);
 try{
  const calls=await api('calls?offset='+callOffset);
  if(!calls.length)panel.querySelector('#call-list')!.textContent='No calls on this page.';
  for(const call of calls){
   const b=document.createElement('button');b.className='history-call';
   const duration=call.started?Math.max(0,Math.round((call.ended??Date.now()/1000)-call.started)):0;
   b.textContent=`${call.agent_name} · ${new Date(call.created*1000).toLocaleString()} · ${Math.floor(duration/60)}m ${duration%60}s · ${call.reason??call.status}`;
   b.onclick=async()=>{try{
    const detail=await api('calls/'+call.id);const container=panel.querySelector('#call-detail')!;container.replaceChildren();
    const title=document.createElement('h2');title.textContent=`${detail.agent_name} · Script v${detail.version}`;container.append(title);
    if(!detail.messages.length)container.append(document.createTextNode('No transcript captured.'));
    for(const message of detail.messages){const row=document.createElement('div');row.className='history-message';const role=document.createElement('strong');role.textContent=message.role+' · '+new Date(message.at*1000).toLocaleTimeString();const text=document.createElement('p');text.textContent=message.text;row.append(role,text);container.append(row);}
   }catch(error){notice((error as Error).message);}};
   panel.querySelector('#call-list')!.append(b);
  }
  const prev=panel.querySelector<HTMLButtonElement>('#calls-prev')!,next=panel.querySelector<HTMLButtonElement>('#calls-next')!;
  prev.disabled=callOffset===0;next.disabled=calls.length<50;
  prev.onclick=()=>{callOffset=Math.max(0,callOffset-50);void showCalls();};next.onclick=()=>{callOffset+=50;void showCalls();};
 }catch(error){notice((error as Error).message);}
}
el('show-calls').onclick=()=>{callOffset=0;void showCalls();};

let businessSource:Record<string,unknown>={};
async function showBusiness(){
 if(dirty&&!confirm('Discard unsaved script changes?'))return;
 dirty=false;el('editor').hidden=true;document.getElementById('call-history')?.remove();document.getElementById('business-profile')?.remove();
 const panel=document.createElement('section');panel.id='business-profile';
 panel.innerHTML='<p class="eyebrow">BUSINESS KNOWLEDGE</p><h1>Import a business website.</h1><p class="hint">Enter the company domain. Scrapling checks the homepage and a few same-domain About, Services, Contact, Hours, or Location pages. Review the result before saving it.</p><form id="business-form"><label>Business domain<input name="domain" type="text" placeholder="example.com" required maxlength="500"></label><button id="preview-business" type="submit">Preview website data</button><label>Agent business context<textarea name="content" rows="20" minlength="10" maxlength="18000" placeholder="Imported facts will appear here."></textarea></label><div class="business-actions"><button id="save-business" type="button" disabled>Save business context</button></div><p id="business-pages" class="hint"></p><hr><h2>Create a customer trial link</h2><div class="row"><label>Company label<input name="label" maxlength="120" placeholder="Acme Plumbing demo"></label><label>Agent category<select name="agent_id">'+agents.filter(a=>a.enabled).map(a=>`<option value="${a.id}">${a.name}</option>`).join('')+'</select></label></div><label>Trial minutes<input name="minutes" type="number" min="1" max="120" value="10"></label><button id="generate-link" type="button">Generate customer link</button><label>Generated link<input name="generated_link" readonly placeholder="Save the business context, then generate a link."></label><div id="demo-links"></div></form>';
 el('workspace').append(panel);
 const form=panel.querySelector<HTMLFormElement>('#business-form')!;
 try{const saved=await api('business');if(saved.profile){(form.elements.namedItem('domain') as HTMLInputElement).value=saved.profile.domain;(form.elements.namedItem('content') as HTMLTextAreaElement).value=saved.profile.content;businessSource=saved.profile.source??{};panel.querySelector<HTMLButtonElement>('#save-business')!.disabled=false;}}catch(error){notice((error as Error).message);}
 form.onsubmit=async event=>{event.preventDefault();const button=panel.querySelector<HTMLButtonElement>('#preview-business')!;button.disabled=true;button.textContent='Reading website…';try{const domain=(form.elements.namedItem('domain') as HTMLInputElement).value;const preview=await api('business/preview','POST',{domain});(form.elements.namedItem('domain') as HTMLInputElement).value=preview.domain;(form.elements.namedItem('content') as HTMLTextAreaElement).value=preview.content;businessSource={pages:preview.pages,facts:preview.facts};panel.querySelector('#business-pages')!.textContent='Pages checked: '+preview.pages.join(', ');panel.querySelector<HTMLButtonElement>('#save-business')!.disabled=false;notice('Preview ready. Review it, then save.');}catch(error){notice((error as Error).message);}finally{button.disabled=false;button.textContent='Preview website data';}};
 panel.querySelector<HTMLButtonElement>('#save-business')!.onclick=async()=>{const button=panel.querySelector<HTMLButtonElement>('#save-business')!;button.disabled=true;try{await api('business','PUT',{domain:(form.elements.namedItem('domain') as HTMLInputElement).value,content:(form.elements.namedItem('content') as HTMLTextAreaElement).value,source:businessSource});notice('Business context saved. New demo calls will use it.');}catch(error){notice((error as Error).message);}finally{button.disabled=false;}};
 panel.querySelector<HTMLButtonElement>('#generate-link')!.onclick=async()=>{const button=panel.querySelector<HTMLButtonElement>('#generate-link')!;button.disabled=true;try{const result=await api('demo-links','POST',{label:(form.elements.namedItem('label') as HTMLInputElement).value,agent_id:(form.elements.namedItem('agent_id') as HTMLSelectElement).value,minutes:Number((form.elements.namedItem('minutes') as HTMLInputElement).value)});const output=form.elements.namedItem('generated_link') as HTMLInputElement;output.value=result.url;output.select();await navigator.clipboard?.writeText(result.url);notice('Customer demo link generated and copied.');await renderDemoLinks(panel);}catch(error){notice((error as Error).message);}finally{button.disabled=false;}};
 await renderDemoLinks(panel);
}
el('show-business').onclick=()=>void showBusiness();

async function renderDemoLinks(panel:HTMLElement){const links=await api('demo-links');const target=panel.querySelector<HTMLElement>('#demo-links')!;target.replaceChildren();for(const link of links){const row=document.createElement('p');row.className='demo-link-row';row.textContent=`${link.label} · ${link.agent_id} · ${Math.ceil(link.used_seconds/60)}/${link.allotted_seconds/60} min${link.active?'':' · Disabled'}`;target.append(row);}}
