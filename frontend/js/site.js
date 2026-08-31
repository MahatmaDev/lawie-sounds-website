/* ══════════════════════════════════════════════════════════════════════
   LAWIE SOUNDS — SHARED SITE BEHAVIOUR

   The chrome every public page has in common: the sticky header, the
   mobile menu, the announcement bar, scroll reveals, the lightbox, the
   toast, and — the reason this file exists at all — one implementation
   of "how long ago was this?".

   Everything is exposed on `window.LS` for pages to call, and the parts
   that are pure chrome wire themselves up on DOMContentLoaded, guarded
   by the presence of the element they act on. A page that has no
   announcement bar simply never runs that code.

   Loaded with `defer` on every public page, BEFORE the page's own
   script, so `LS` exists by the time page code runs.
   ══════════════════════════════════════════════════════════════════════ */
(() => {
  'use strict';

  // ── Constants ─────────────────────────────────────────────────────
  const WA_NUMBER = '254703925826';
  const SITE      = 'https://lawiesounds.com';
  const BOOK_URL  = '/book';

  const $  = (id) => document.getElementById(id);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

  // Anything heading for an href gets checked here as well as on the
  // server. A javascript: URL that reaches element.href has already won.
  const safeHref = (url, fallback = BOOK_URL) => {
    const v = String(url || '').trim();
    if (!v || /^\s*(javascript|data|vbscript|file):/i.test(v)) return fallback;
    return /^(\/|#|https?:\/\/|tel:|mailto:)/i.test(v) ? v : fallback;
  };

  async function api(path) {
    try {
      const r = await fetch(path, { headers: { Accept: 'application/json' } });
      if (!r.ok) throw new Error(String(r.status));
      return await r.json();
    } catch { return null; }
  }

  // ══════════════════════════════════════════════════════════════════
  // TIMESTAMPS
  //
  // One implementation, one vocabulary. Before this, "when" was written
  // three different ways on three pages and two of them silently printed
  // "Invalid Date" for a null column.
  //
  // Two rules hold everywhere:
  //   1. A bad or missing date renders as nothing, never as "Invalid
  //      Date" and never as the epoch. An absent timestamp is a fact we
  //      do not have, and the honest rendering of it is silence.
  //   2. Anything under a week is relative ("3 days ago") and anything
  //      older is absolute ("14 Jun 2026"). Relative is what makes a
  //      site feel current; absolute is what stays useful a year later,
  //      when "8 months ago" tells a reader nothing they can place.
  // ══════════════════════════════════════════════════════════════════
  const MIN = 60000, HOUR = 3600000, DAY = 86400000;

  const parseDate = (iso) => {
    if (!iso) return null;
    const d = iso instanceof Date ? iso : new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d;
  };

  const daysBetween = (a, b) => Math.round((a - b) / DAY);

  /** "just now" · "12 minutes ago" · "3 days ago" · "14 Jun 2026" */
  function timeAgo(iso, { absoluteAfterDays = 7 } = {}) {
    const d = parseDate(iso);
    if (!d) return '';
    const diff = Date.now() - d.getTime();

    // A clock skewed a few minutes into the future is common on phones
    // and is not worth a different vocabulary; treat it as now.
    if (diff < 0 && diff > -5 * MIN) return 'just now';
    if (diff < 0) return prettyDate(d);

    if (diff < MIN)      return 'just now';
    if (diff < HOUR)     { const n = Math.floor(diff / MIN);  return `${n} minute${n === 1 ? '' : 's'} ago`; }
    if (diff < DAY)      { const n = Math.floor(diff / HOUR); return `${n} hour${n === 1 ? '' : 's'} ago`; }
    if (diff < 2 * DAY)  return 'yesterday';
    if (diff < absoluteAfterDays * DAY) { const n = Math.floor(diff / DAY); return `${n} days ago`; }
    return prettyDate(d);
  }

  /** "14 Jun 2026" */
  function prettyDate(iso) {
    const d = parseDate(iso);
    if (!d) return '';
    return d.toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  /** "14 Jun 2026, 19:40" — for the dashboard, where precision matters */
  function prettyDateTime(iso) {
    const d = parseDate(iso);
    if (!d) return '';
    return d.toLocaleString('en-KE', {
      day: 'numeric', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false,
    });
  }

  /** Full, unambiguous — used as the `title` so hovering a relative
      stamp reveals exactly what it stands for. */
  function fullDate(iso) {
    const d = parseDate(iso);
    if (!d) return '';
    return d.toLocaleString('en-KE', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false,
    });
  }

  /** Recent enough to be worth a badge. Default two weeks. */
  function isNew(iso, days = 14) {
    const d = parseDate(iso);
    if (!d) return false;
    const age = daysBetween(Date.now(), d.getTime());
    return age >= 0 && age <= days;
  }

  /** "Ends today" · "Ends tomorrow" · "9 days left" · null when the
      deadline is past, absent, or too far off to create any urgency. */
  function endsIn(iso, horizonDays = 21) {
    const d = parseDate(iso);
    if (!d) return null;
    const left = daysBetween(d.getTime(), Date.now());
    if (left < 0) return null;
    if (left === 0) return 'Ends today';
    if (left === 1) return 'Ends tomorrow';
    if (left <= horizonDays) return `${left} days left`;
    return null;
  }

  /** "in 3 days" · "tomorrow" · "today" — forward-looking, for events. */
  function countdown(iso) {
    const d = parseDate(iso);
    if (!d) return '';
    const left = daysBetween(d.getTime(), Date.now());
    if (left < 0)  return prettyDate(d);
    if (left === 0) return 'today';
    if (left === 1) return 'tomorrow';
    if (left <= 30) return `in ${left} days`;
    return prettyDate(d);
  }

  /**
   * The stamp markup itself, so every "posted X ago" on the site is the
   * same element with the same title and the same machine-readable
   * datetime. `<time datetime>` is what lets a crawler date the content
   * — a bare string of text does not.
   */
  function stamp(iso, { icon = 'fa-clock', prefix = '', cls = 'stamp' } = {}) {
    const d = parseDate(iso);
    if (!d) return '';
    return `<time class="${esc(cls)}" datetime="${esc(d.toISOString())}" data-ts title="${esc(fullDate(d))}">` +
           (icon ? `<i class="fas ${esc(icon)}"></i>` : '') +
           `${esc(prefix)}${esc(timeAgo(d))}</time>`;
  }

  /**
   * Re-render every `<time data-ts>` in place. Called once on load and
   * then once a minute, so a page left open on a phone does not sit
   * saying "just now" an hour later. Only the text changes; the
   * datetime attribute is the source of truth and is never rewritten.
   */
  function hydrateStamps(root = document) {
    for (const el of $$('time[data-ts]', root)) {
      const iso = el.getAttribute('datetime');
      const d = parseDate(iso);
      if (!d) { el.remove(); continue; }
      const icon = el.querySelector('i');
      const text = timeAgo(d);
      el.textContent = text;
      if (icon) el.prepend(icon);
      if (!el.title) el.title = fullDate(d);
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // SHORT SECTION URLS
  //
  // /how, /reviews, /faq and friends are real, shareable URLs: on the
  // server they 301 to the matching homepage anchor. Here they are made
  // to behave like anchors when the section is already on the page —
  // smooth scroll, no navigation, and the address bar left showing the
  // short URL rather than a hash. One href works on every page, which
  // is what lets the header be shared markup at all.
  // ══════════════════════════════════════════════════════════════════
  const SECTIONS = {
    latest:  'latest',
    work:    'work',
    how:     'how',
    reviews: 'reviews',
    about:   'about',
    faq:     'faq',
    contact: 'contact',
  };

  function scrollToSection(id) {
    const target = document.getElementById(id);
    if (!target) return false;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    target.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    // Move focus too, or a keyboard user's next Tab continues from the
    // top of the document rather than from where the page just moved.
    target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
    return true;
  }

  function wireSectionLinks() {
    document.addEventListener('click', (ev) => {
      const a = ev.target.closest('a[href]');
      if (!a || ev.defaultPrevented || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button !== 0) return;
      if (a.target && a.target !== '_self') return;

      const href = a.getAttribute('href') || '';
      const key = href.replace(/^\/+|\/+$/g, '');
      const id = SECTIONS[key] || (href.startsWith('#') ? href.slice(1) : null);
      if (!id) return;
      if (!document.getElementById(id)) return;   // not on this page — let it navigate

      ev.preventDefault();
      scrollToSection(id);
      const short = Object.keys(SECTIONS).find((k) => SECTIONS[k] === id);
      try { history.replaceState(null, '', short ? `/${short}` : `#${id}`); } catch {}
    });

    // Arriving at /#faq (which is where the 301 lands) — tidy the
    // address bar to /faq so the URL that gets copied is the short one.
    const hash = (location.hash || '').slice(1);
    if (hash && document.getElementById(hash)) {
      const short = Object.keys(SECTIONS).find((k) => SECTIONS[k] === hash);
      if (short) { try { history.replaceState(null, '', `/${short}`); } catch {} }
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // CHROME
  // ══════════════════════════════════════════════════════════════════
  const revealer = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) { e.target.classList.add('in'); revealer.unobserve(e.target); }
    }
  }, { threshold: 0.08, rootMargin: '0px 0px -40px' });
  const observeReveals = (root = document) => $$('.reveal', root).forEach((el) => revealer.observe(el));

  function wireHeader() {
    const header = document.querySelector('.site-header');
    if (header) {
      const onScroll = () => header.classList.toggle('stuck', window.scrollY > 24);
      window.addEventListener('scroll', onScroll, { passive: true });
      onScroll();
    }

    const menuBtn = $('menuBtn'), mobileNav = $('mobileNav');
    if (menuBtn && mobileNav) {
      menuBtn.addEventListener('click', () => {
        const open = mobileNav.hasAttribute('hidden');
        mobileNav.toggleAttribute('hidden', !open);
        menuBtn.setAttribute('aria-expanded', String(open));
        menuBtn.innerHTML = `<i class="fas fa-${open ? 'xmark' : 'bars'}"></i>`;
      });
      $$('.mnav').forEach((a) => a.addEventListener('click', () => {
        mobileNav.setAttribute('hidden', '');
        menuBtn.setAttribute('aria-expanded', 'false');
        menuBtn.innerHTML = '<i class="fas fa-bars"></i>';
      }));
    }

    // Mark the nav entry for the page we are on. On the homepage the
    // in-view observer below takes over and keeps it moving.
    const path = location.pathname.replace(/\/+$/, '') || '/';
    $$('.nav-link, .mnav').forEach((a) => {
      const href = (a.getAttribute('href') || '').replace(/\/+$/, '');
      if (href && href === path) a.classList.add('active');
    });
  }

  /** Homepage only: highlight whichever section is currently in view. */
  function wireScrollSpy() {
    const links = new Map();
    for (const a of $$('.nav-link')) {
      const href = (a.getAttribute('href') || '').replace(/^\/+|^#/, '').replace(/\/+$/, '');
      const id = SECTIONS[href] || href;
      if (id && document.getElementById(id)) links.set(id, a);
    }
    if (!links.size) return;
    const spy = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const link = links.get(e.target.id);
        if (!link) continue;
        links.forEach((l) => l.classList.remove('active'));
        link.classList.add('active');
      }
    }, { rootMargin: '-45% 0px -50%' });
    links.forEach((_, id) => spy.observe(document.getElementById(id)));
  }

  function wireMisc() {
    const y = $('year');
    if (y) y.textContent = String(new Date().getFullYear());

    const top = $('toTop');
    if (top) top.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
  }

  /**
   * Upgrade every /wa link to a chat with the first message already
   * written. A blank chat makes the visitor compose the opener, which is
   * work, and plenty of them abandon it there.
   *
   * The links ship as plain `/wa` so they still reach WhatsApp with a
   * short opener when this never runs — the server redirect handles that.
   * This only makes a working link better.
   */
  function primeWhatsApp() {
    const text = encodeURIComponent(
      'Hi Lawie Sounds 👋 I\'d like a quote for an event.\n\n' +
      'Date:\nVenue:\nGuests:\nWhat I need:'
    );
    const href = `https://wa.me/${WA_NUMBER}?text=${text}`;
    for (const a of $$('a[href="/wa"], a[href="/wa/"], a[href*="wa.me"]')) {
      a.href = href;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // ANNOUNCEMENT BAR
  //
  // Admin-controlled, and dismissible per banner rather than per site:
  // dismissing October's offer must not hide November's. The dismissal
  // is keyed by banner id for exactly that reason.
  // ══════════════════════════════════════════════════════════════════
  const DISMISS_KEY = 'lawie_announce_dismissed';

  function dismissed() {
    try { return new Set(JSON.parse(localStorage.getItem(DISMISS_KEY) || '[]')); }
    catch { return new Set(); }
  }

  async function loadAnnouncement() {
    const bar = $('announce');
    if (!bar) return;

    const res = await api('/api/banners');
    const now = new Date();
    const gone = dismissed();
    const live = (res?.data || []).find((b) => !gone.has(b.id) && (!b.endDate || new Date(b.endDate) >= now));
    if (!live) return;

    const msg = $('announceMsg'), cta = $('announceCta'), ends = $('announceEnds'), close = $('announceClose');
    if (msg) msg.textContent = live.message || '';
    if (cta) {
      cta.href = safeHref(live.ctaLink);
      cta.innerHTML = `${esc(live.ctaText || 'Find out more')} <i class="fas fa-arrow-right" style="font-size:11px"></i>`;
      cta.addEventListener('click', () => track(live.id, 'click'));
    }
    if (ends) {
      const closing = endsIn(live.endDate);
      ends.textContent = closing || '';
      ends.hidden = !closing;
    }
    if (close) {
      close.addEventListener('click', () => {
        bar.hidden = true;
        const set = dismissed(); set.add(live.id);
        try { localStorage.setItem(DISMISS_KEY, JSON.stringify([...set])); } catch {}
      });
    }
    bar.hidden = false;
    track(live.id, 'view');
  }

  // Fire-and-forget: a failed metric must never be visible to a visitor
  // or hold up anything they are waiting for.
  function track(id, metric) {
    try { fetch(`/api/banners/${id}/${metric}`, { method: 'POST', keepalive: true }).catch(() => {}); } catch {}
  }

  // ══════════════════════════════════════════════════════════════════
  // TOAST
  // ══════════════════════════════════════════════════════════════════
  let toastEl = null, toastTimer = null;
  function toast(message, kind = 'good') {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'toast';
      toastEl.setAttribute('role', 'status');
      toastEl.setAttribute('aria-live', 'polite');
      document.body.appendChild(toastEl);
    }
    toastEl.className = `toast ${kind}`;
    toastEl.innerHTML = `<i class="fas fa-${kind === 'bad' ? 'circle-exclamation' : 'circle-check'}"></i><span>${esc(message)}</span>`;
    requestAnimationFrame(() => toastEl.classList.add('up'));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('up'), 4200);
  }

  // ══════════════════════════════════════════════════════════════════
  // LIGHTBOX
  //
  // Shared by the homepage strip, /gallery and the service pages, so a
  // photograph opens the same way wherever it is clicked. Pages hand it
  // a list and an index; it owns the keyboard, the focus trap and the
  // restore-focus-on-close that a gallery built per page always forgets.
  // ══════════════════════════════════════════════════════════════════
  const lightbox = {
    items: [], index: 0, opener: null,

    open(items, index = 0, opener = null) {
      const box = $('lightbox');
      if (!box || !items.length) return;
      this.items = items; this.index = index; this.opener = opener || document.activeElement;
      box.classList.add('open');
      document.body.style.overflow = 'hidden';
      this.render();
      $('lbClose')?.focus();
    },

    close() {
      const box = $('lightbox');
      if (!box) return;
      box.classList.remove('open');
      document.body.style.overflow = '';
      const stage = $('lbStage');
      if (stage) stage.innerHTML = '';          // stop any playing video
      this.opener?.focus?.();
    },

    step(delta) {
      if (!this.items.length) return;
      this.index = (this.index + delta + this.items.length) % this.items.length;
      this.render();
    },

    render() {
      const it = this.items[this.index];
      if (!it) return;
      const stage = $('lbStage'), cap = $('lbCaption'), count = $('lbCount'), thumbs = $('lbThumbs');

      if (stage) {
        stage.innerHTML = it.type === 'video'
          ? `<video src="${esc(it.src)}" controls autoplay playsinline ${it.poster ? `poster="${esc(it.poster)}"` : ''}></video>`
          : `<img src="${esc(it.src)}" alt="${esc(it.alt || it.title || '')}">`;
      }
      if (cap) {
        cap.innerHTML = `<strong style="display:block;font-size:15px">${esc(it.title || '')}</strong>` +
          (it.date ? `<span class="stamp" style="margin-top:4px"><i class="fas fa-calendar"></i>${esc(prettyDate(it.date))}</span>` : '');
      }
      if (count) count.textContent = `${this.index + 1} / ${this.items.length}`;
      if (thumbs) {
        thumbs.innerHTML = this.items.map((t, i) =>
          `<button type="button" class="${i === this.index ? 'on' : ''}" data-i="${i}" aria-label="Show item ${i + 1}">
             <img src="${esc(t.poster || t.src)}" alt="" loading="lazy">
           </button>`).join('');
        $$('button', thumbs).forEach((b) => b.addEventListener('click', () => { this.index = Number(b.dataset.i); this.render(); }));
      }
    },
  };

  function wireLightbox() {
    const box = $('lightbox');
    if (!box) return;
    $('lbClose')?.addEventListener('click', () => lightbox.close());
    $('lbPrev')?.addEventListener('click', () => lightbox.step(-1));
    $('lbNext')?.addEventListener('click', () => lightbox.step(1));
    box.addEventListener('click', (e) => { if (e.target === box) lightbox.close(); });
    document.addEventListener('keydown', (e) => {
      if (!box.classList.contains('open')) return;
      if (e.key === 'Escape')     lightbox.close();
      if (e.key === 'ArrowLeft')  lightbox.step(-1);
      if (e.key === 'ArrowRight') lightbox.step(1);
    });
  }

  // ══════════════════════════════════════════════════════════════════
  // BOOT
  // ══════════════════════════════════════════════════════════════════
  function boot() {
    wireHeader();
    wireScrollSpy();
    wireSectionLinks();
    wireMisc();
    primeWhatsApp();
    wireLightbox();
    observeReveals();
    hydrateStamps();
    loadAnnouncement();
    // A page left open should not keep insisting something happened
    // "just now" an hour after it did.
    setInterval(() => hydrateStamps(), MIN);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();

  // ── Media renditions ──────────────────────────────────────────────
  //
  // A row from the API carries either `renditions` — produced by the media
  // worker, one entry per size — or only `imageUrl`, which is every row written
  // before the cloud pipeline existed. Both cases go through here so no page
  // has to know which kind it is holding, and so the grid can stop loading
  // full-size photographs to paint 480px tiles.

  const LADDER = ['thumb', 'card', 'web', 'poster', 'preview'];

  function mediaSrc(item, variant = 'thumb') {
    const r = item && item.renditions;
    if (r) {
      if (r[variant] && r[variant].url) return r[variant].url;
      // Walk the ladder. A small source never produces the larger steps, and a
      // video has poster/preview rather than thumb/card/web — so asking for a
      // variant that does not exist must degrade rather than return nothing.
      for (const v of LADDER) if (r[v] && r[v].url) return r[v].url;
    }
    return (item && item.imageUrl) || '';
  }

  // Let the browser pick. It knows the viewport, the device pixel ratio and
  // whether the connection is worth spending on; we do not.
  function mediaSrcset(item) {
    const r = item && item.renditions;
    if (!r) return '';
    return ['thumb', 'card', 'web']
      .filter(v => r[v] && r[v].url && r[v].width)
      .map(v => `${r[v].url} ${r[v].width}w`)
      .join(', ');
  }

  // ── Public surface ────────────────────────────────────────────────
  window.LS = {
    WA_NUMBER, SITE, BOOK_URL,
    $, $$, esc, safeHref, api,
    timeAgo, prettyDate, prettyDateTime, fullDate, isNew, endsIn, countdown, stamp, hydrateStamps, parseDate,
    observeReveals, scrollToSection, toast, lightbox, track,
    mediaSrc, mediaSrcset,
  };
})();
