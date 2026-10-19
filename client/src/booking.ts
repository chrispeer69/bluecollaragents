import './booking.css';

/** Navigation from the demo to the dedicated sales page. */
export function mountBooking(parent: HTMLElement) {
  const link = document.createElement('a');
  link.className = 'contact-sales';
  link.textContent = 'Contact sales';
  link.href = './contact-sales.html';
  parent.append(link);
}

/** GHL owns the embedded form on the dedicated sales page. */
export function mountBookingPage(parent: HTMLElement) {
  const rawUrl = import.meta.env.VITE_GHL_CALENDAR_URL?.trim();
  let bookingUrl: URL | undefined;
  try {
    const candidate = new URL(rawUrl || '');
    if (candidate.protocol === 'https:' && !candidate.username && !candidate.password) bookingUrl = candidate;
  } catch { /* Show the unavailable state until a public URL is configured. */ }

  const section = document.createElement('section');
  section.id = 'contact-sales';
  section.className = 'sales-booking-section';
  section.setAttribute('aria-labelledby', 'sales-booking-title');
  section.innerHTML = `<header><span>LET’S TALK</span><h2 id="sales-booking-title" tabindex="-1">Find a time to talk.</h2><p>See how Blue Collar Agents can work for your business.</p></header><div class="sales-booking-frame"></div>`;
  if (bookingUrl) {
    const frame = document.createElement('iframe');
    frame.src = bookingUrl.href;
    frame.allow = 'payment';
    frame.id = 'ghl-sales-calendar';
    frame.setAttribute('scrolling', 'no');
    frame.title = 'Book a call with Blue Collar Agents';
    frame.loading = 'lazy';
    frame.referrerPolicy = 'strict-origin-when-cross-origin';
    section.querySelector('.sales-booking-frame')!.append(frame);
  } else {
    section.querySelector('.sales-booking-frame')!.innerHTML = '<p class="booking-unavailable">Online scheduling is coming soon. Please check back shortly.</p>';
  }
  parent.append(section);
  if (bookingUrl) {
    // GHL's official script resizes the cross-origin frame as booking steps change.
    const script = document.createElement('script');
    script.src = new URL('/js/form_embed.js', bookingUrl.origin).href;
    script.async = true;
    script.onerror = () => {
      // Keep the form usable if a browser extension blocks the resizing script.
      section.querySelector('iframe')!.setAttribute('scrolling', 'auto');
      const fallback = document.createElement('a');
      fallback.href = bookingUrl!.href;
      fallback.textContent = 'Open the booking calendar in a full page ↗';
      fallback.className = 'booking-fallback';
      section.append(fallback);
    };
    document.body.append(script);
  }
}
