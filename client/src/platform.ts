import './platform.css';

export function mountPlatform(endCall: () => Promise<void>) {
  const shell = document.querySelector<HTMLElement>('.shell')!;
  const header = shell.querySelector<HTMLElement>('.topbar')!;
  const banner = document.createElement('div');
  banner.className = 'platform-banner';
  banner.innerHTML = 'Meet your next voice agent. <a href="#agent-demo">Try a live demo <span aria-hidden="true">↗</span></a>';
  header.before(banner);
  const nav = document.createElement('nav');
  nav.className = 'platform-nav';
  nav.setAttribute('aria-label','Main navigation');
  nav.innerHTML = `<details><summary>Solutions <span>⌄</span></summary><div class="nav-menu"><a href="#solutions">Roadside & towing <small>Keep customers informed</small></a><a href="#solutions">Home services <small>Make the next conversation count</small></a><a href="#solutions">Sales & scheduling <small>Turn interest into a next step</small></a></div></details><details><summary>Platform <span>⌄</span></summary><div class="nav-menu"><a href="#agent-demo">Voice agents <small>Choose an agent and try a call</small></a><a href="#voice-demo" data-open-demo>Live conversations <small>Follow along with the transcript</small></a><a href="./contact-sales.html">Booking <small>Find a time to meet our team</small></a></div></details><a href="#solutions">Use cases</a><details><summary>Resources <span>⌄</span></summary><div class="nav-menu"><a href="#how-it-works">How it works <small>From first hello to the next step</small></a><a href="./contact-sales.html">Talk to our team <small>Discuss your business needs</small></a></div></details>`;
  header.querySelector('.brand')!.after(nav);
  const menus = Array.from(nav.querySelectorAll('details'));
  menus.forEach(menu=>menu.addEventListener('toggle',()=>{if(menu.open)menus.forEach(other=>{if(other!==menu)other.open=false;});}));
  document.addEventListener('click',event=>{if(!nav.contains(event.target as Node))menus.forEach(menu=>menu.open=false);});
  nav.addEventListener('keydown',event=>{if(event.key==='Escape'){const open=menus.find(menu=>menu.open);menus.forEach(menu=>menu.open=false);open?.querySelector('summary')?.focus();}});
  nav.querySelectorAll('a').forEach(a=>a.addEventListener('click',()=>menus.forEach(menu=>menu.open=false)));

  const hero = shell.querySelector<HTMLElement>('.hero')!;
  hero.id = 'agent-demo';
  hero.innerHTML = `<div class="hero-copy"><p class="eyebrow">AI RECEPTIONISTS FOR SERVICE BUSINESSES</p><h1>Turn more calls<br>into <em>booked jobs.</em></h1><p class="lede">Your AI agent answers every call, qualifies the customer, and books the next step—while your team stays focused on the work.</p><div class="hero-links"><a href="#agent-picker" class="hero-primary">Try a live demo <span>↗</span></a><a href="./contact-sales.html" class="hero-secondary">Book a consultation</a></div><div id="agent-picker" class="agent-launcher"><label class="sr-only" for="demo-agent">Choose a demo agent</label><select id="demo-agent" disabled><option>Loading agents…</option></select></div><p class="mic-note">Choose an agent and experience a real conversation</p></div><div class="hero-art" aria-hidden="true"><div class="spectrum-aura"></div><div class="spectrum-blob"><div class="spectrum-sheen"></div></div><div class="spectrum-orbit"></div></div>`;
  const connect = document.querySelector<HTMLButtonElement>('#connect')!;
  connect.querySelector('span')!.textContent='Start call';
  hero.querySelector('.agent-launcher')!.append(connect);
  const consolePanel = document.querySelector<HTMLElement>('#voice-demo')!;
  const intro = document.querySelector<HTMLElement>('.demo-intro')!;
  intro.remove();
  const callView = document.createElement('div');
  callView.className = 'hero-call-view';
  callView.hidden = true;
  callView.innerHTML = '<button type="button" class="hero-back">← Back</button><div class="hero-call-heading"><div><p class="eyebrow">LIVE VOICE AGENT</p><h2 tabindex="-1"></h2><p>Speak naturally and watch the conversation unfold.</p></div><a href="./contact-sales.html">Want one for your business? Contact sales ↗</a></div>';
  const facts = document.createElement('aside');
  facts.className = 'call-facts';
  facts.innerHTML = '<div><small>USE CASE</small><strong data-call-use>Voice agent</strong></div><div><small>STATUS</small><strong>Live demo</strong><span>Real-time voice conversation</span></div><div class="sales-prompt"><small>BUILD YOUR AGENT</small><strong>Ready to put voice AI to work?</strong><a href="./contact-sales.html">Contact sales ↗</a></div>';
  consolePanel.append(facts);
  callView.append(consolePanel);
  hero.append(callView);
  const copy = hero.querySelector<HTMLElement>('.hero-copy')!;
  const art = hero.querySelector<HTMLElement>('.hero-art')!;
  const back = callView.querySelector<HTMLButtonElement>('.hero-back')!;
  const reveal = (agentName?: string) => {
    copy.hidden = true;
    art.hidden = true;
    consolePanel.hidden = false;
    callView.hidden = false;
    hero.classList.add('in-call');
    const picker = document.querySelector<HTMLSelectElement>('#demo-agent')!;
    const heading = callView.querySelector('h2')!;
    heading.textContent = agentName || picker.selectedOptions[0]?.textContent || 'Voice agent demo';
    callView.querySelector<HTMLElement>('[data-call-use]')!.textContent = heading.textContent;
    heading.focus({preventScroll:true});
  };
  window.addEventListener('voice-call-starting',event=>reveal((event as CustomEvent<{agentName?:string}>).detail?.agentName));
  back.addEventListener('click',async()=>{
    back.disabled=true;
    back.textContent='Ending call…';
    try {
      await endCall();
      callView.hidden=true;
      copy.hidden=false;
      art.hidden=false;
      hero.classList.remove('in-call');
      document.querySelector<HTMLSelectElement>('#demo-agent')!.focus({preventScroll:true});
    } finally {
      back.disabled=false;
      back.textContent='← Back';
    }
  });
  nav.querySelector('[data-open-demo]')!.addEventListener('click',event=>{
    event.preventDefault();
    if(!connect.disabled) connect.click();
  });
  header.querySelector('.header-actions>a')!.setAttribute('href','#agent-demo');
  header.querySelector('.header-actions>a')!.textContent='Try an agent';

  const info = document.createElement('section');
  info.className='platform-content';
  info.innerHTML=`<div class="section-heading" id="solutions"><p>ONE PLATFORM. DIFFERENT CONVERSATIONS.</p><h2>A voice for every<br>part of your business.</h2></div><div class="use-cases"><article><span class="case-number">01 / OPERATIONS</span><h3>Keep the job moving.</h3><p>Hear the tow agent confirm tow details in a live simulated customer call.</p><a href="#agent-demo">Try the tow agent <span>↗</span></a></article><article><span class="case-number">02 / CUSTOMER EXPERIENCE</span><h3>Be there for the next call.</h3><p>Explore a voice agent for customer questions and service enquiries.</p><a href="./contact-sales.html">Discuss your agent <span>↗</span></a></article><article><span class="case-number">03 / GROWTH</span><h3>Give every lead a next step.</h3><p>Plan an agent for qualification, follow-ups, and appointment scheduling.</p><a href="./contact-sales.html">Talk to sales <span>↗</span></a></article></div><div class="how-it-works" id="how-it-works"><div><p>HEAR IT FOR YOURSELF</p><h2>Less imagining.<br>More conversation.</h2></div><ol><li><strong>Choose your agent.</strong><span>Choose support, qualification, scheduling, or tow confirmation.</span></li><li><strong>Start talking.</strong><span>Allow your microphone and respond naturally.</span></li><li><strong>See it happen.</strong><span>Watch the voice animation and follow the live transcript.</span></li></ol></div>`;
  shell.querySelector('.experience-footer')!.before(info);
  shell.querySelector('.demo-settings')?.remove();
}
