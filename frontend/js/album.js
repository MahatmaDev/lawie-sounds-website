(() => {
  'use strict';

  const { $, esc, toast, prettyDate, mediaSrc, mediaSrcset } = window.LS;
  const CONSENT_VERSION = 'public-use-v1';
  const ALBUM_TIME_ZONE = 'Africa/Nairobi';
  let token = '';
  let sessionKey = '';

  try {
    token = decodeURIComponent((location.pathname.split('/')[2] || '').trim());
  } catch {
    token = '';
  }

  const keyStore = `lawie_album_key_${token}`;
  const states = ['loading', 'problem', 'gone', 'locked', 'album'];

  function show(state) {
    for (const id of states) $(id).classList.toggle('hidden', id !== state);
  }

  function formatAlbumTimestamp(value) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '';
    return new Intl.DateTimeFormat('en-KE', {
      timeZone: ALBUM_TIME_ZONE,
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZoneName: 'short',
    }).format(date);
  }

  function setDeadline(containerId, timeId, value) {
    const container = $(containerId);
    const time = $(timeId);
    const formatted = value ? formatAlbumTimestamp(value) : '';
    if (value && !formatted) console.error('The album has an invalid expiry timestamp.');
    container.classList.toggle('hidden', !formatted);
    if (formatted) {
      time.dateTime = new Date(value).toISOString();
      time.textContent = formatted;
    } else {
      time.removeAttribute('datetime');
      time.textContent = '';
    }
  }

  function albumKey() {
    try {
      return sessionStorage.getItem(keyStore) || sessionKey;
    } catch {
      return sessionKey;
    }
  }

  async function call(path, options = {}) {
    const headers = { Accept: 'application/json', ...(options.headers || {}) };
    if (options.body) headers['Content-Type'] = 'application/json';
    const key = albumKey();
    if (key) headers['X-Album-Key'] = key;

    try {
      const response = await fetch(`/api/albums/${encodeURIComponent(token)}${path}`, {
        ...options,
        headers,
      });
      const json = await response.json().catch(() => null);
      return { ok: response.ok, status: response.status, json, error: '' };
    } catch {
      return { ok: false, status: 0, json: null, error: 'We couldn’t reach the album service. Check your connection and try again.' };
    }
  }

  function photoHtml(item, index) {
    const isVideo = item.kind === 'video';
    const thumb = mediaSrc(item, isVideo ? 'poster' : 'thumb');
    const full = isVideo ? mediaSrc(item, 'preview') : mediaSrc(item, 'web');
    const srcset = isVideo ? '' : mediaSrcset(item);
    const width = Number.isFinite(Number(item.width)) && Number(item.width) > 0 ? Math.max(1, Math.round(Number(item.width))) : 3;
    const height = Number.isFinite(Number(item.height)) && Number(item.height) > 0 ? Math.max(1, Math.round(Number(item.height))) : 2;
    const caption = String(item.caption || '').trim();
    const label = caption || `${isVideo ? 'Video' : 'Photo'} ${index + 1} from your event`;
    const downloadLabel = caption || `${isVideo ? 'video' : 'photo'} ${index + 1}`;
    const viewLabel = `View ${label}${isVideo ? ' in the video player' : ' larger'}`;
    const viewerAttrs = isVideo
      ? `data-video='${esc(JSON.stringify({ source: [{ src: full, type: 'video/mp4' }], attributes: { preload: 'none', controls: true } }))}' data-poster="${esc(thumb)}"`
      : `data-src="${esc(full)}"`;
    const fullLink = full ? `href="${esc(full)}"` : 'href="#" aria-disabled="true"';

    return `
      <article class="photo" role="listitem" style="--ar:${width} / ${height}" data-index="${index}">
        <a class="photo-viewer" ${fullLink} ${viewerAttrs} aria-label="${esc(viewLabel)}">
          <img src="${esc(thumb)}" ${srcset ? `srcset="${esc(srcset)}" sizes="(max-width:720px) 50vw, 25vw"` : ''}
               alt="${esc(label)}" width="${width}" height="${height}"
               loading="${index < 4 ? 'eager' : 'lazy'}" decoding="async" ${index < 4 ? 'fetchpriority="high"' : ''}>
          <span class="photo-fallback hidden" aria-hidden="true"><i class="fas fa-image"></i> Preview unavailable</span>
          ${isVideo ? '<span class="play-badge" aria-hidden="true"><span><i class="fas fa-play"></i></span></span>' : ''}
        </a>
        <div class="photo-actions">
          <button class="icon-btn js-dl" type="button" data-asset="${esc(item.assetId)}" data-size="web"
                  aria-label="Download ${esc(downloadLabel)}" title="Download a copy">
            <i class="fas fa-download" aria-hidden="true"></i>
          </button>
          ${item.originalAvailable ? `
          <button class="icon-btn js-dl" type="button" data-asset="${esc(item.assetId)}" data-size="original"
                  aria-label="Download the full-resolution original of ${esc(downloadLabel)}" title="Download the full-resolution original">
            <i class="fas fa-maximize" aria-hidden="true"></i>
          </button>` : ''}
        </div>
      </article>`;
  }

  function renderAlbum(album) {
    if (!Array.isArray(album.items)) throw new Error('The album response did not include a photo list.');
    const items = album.items;
    setDeadline('albumDeadline', 'albumDeadlineTime', album.expiresAt);

    $('albumKicker').textContent = album.clientName ? `For ${album.clientName}` : 'Your event';
    $('albumTitle').textContent = album.title || 'Your album';
    document.title = `${album.title || 'Your album'} | Lawie Sounds`;

    const photos = items.filter(item => item.kind !== 'video').length;
    const videos = items.length - photos;
    const summary = [];
    if (album.eventDate) summary.push(prettyDate(album.eventDate));
    if (photos) summary.push(`${photos} ${photos === 1 ? 'photo' : 'photos'}`);
    if (videos) summary.push(`${videos} ${videos === 1 ? 'video' : 'videos'}`);
    $('albumMeta').textContent = summary.join(' · ');
    $('photoCount').textContent = `${items.length} ${items.length === 1 ? 'item' : 'items'}`;

    $('albumNote').textContent = album.message || '';
    $('albumNote').classList.toggle('hidden', !album.message);
    $('grid').innerHTML = items.map(photoHtml).join('');
    $('grid').classList.toggle('hidden', items.length === 0);
    $('emptyAlbum').classList.toggle('hidden', items.length !== 0);

    $('retention').classList.toggle('hidden', !album.originalsUntil);
    if (album.originalsUntil) {
      $('retentionText').textContent =
        `Full-resolution originals can be downloaded until ${prettyDate(album.originalsUntil)}. ` +
        'After that, web copies will remain available here. Save any full-resolution files you want before then.';
    }

    $('consent').checked = album.publicConsent === true;
    if (Array.isArray(album.services) && album.services.length) {
      $('setupChips').innerHTML = album.services
        .map(service => `<a class="setup-chip" href="/s/${encodeURIComponent(service.slug)}"><i class="fas fa-check" aria-hidden="true"></i> ${esc(service.name)}</a>`)
        .join('');
      const slugs = album.services.map(service => service.slug).join(',');
      $('quoteSame').href =
        `/book?service=${encodeURIComponent(slugs)}&channel=${encodeURIComponent(`album:${album.id}`)}`;
      $('setup').classList.remove('hidden');
    } else {
      $('setup').classList.add('hidden');
    }

    const shareText = `Photos from ${album.title || 'our event'} by Lawie Sounds`;
    $('waShare').href = `https://wa.me/?text=${encodeURIComponent(`${shareText} — ${location.href}`)}`;
    show('album');

    if (window.lightGallery && items.length) {
      try {
        window.lightGallery($('grid'), {
          selector: '.photo-viewer',
          plugins: [window.lgZoom].filter(Boolean),
          speed: 300,
          download: false,
          licenseKey: '0000-0000-000-0000',
        });
      } catch (error) {
        console.error('The album lightbox could not start; photo links remain available.', error);
      }
    }
  }

  $('grid').addEventListener('error', (event) => {
    if (!(event.target instanceof HTMLImageElement)) return;
    const photo = event.target.closest('.photo');
    if (!photo) return;
    photo.dataset.broken = 'true';
    photo.querySelector('.photo-fallback')?.classList.remove('hidden');
  }, true);

  $('grid').addEventListener('click', async (event) => {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest('.js-dl');
    if (!button) {
      if (event.target.closest('.photo-viewer[aria-disabled="true"]')) event.preventDefault();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');

    try {
      const { ok, status, json, error } = await call(
        `/download/${encodeURIComponent(button.dataset.asset)}?size=${encodeURIComponent(button.dataset.size)}`);
      if (!ok) {
        toast(status === 410
          ? 'The full-resolution original is no longer stored. The web-size copy is still available.'
          : (json?.error || error || 'Could not prepare that download. Please try again.'), 'bad');
        return;
      }
      if (!json?.data?.url) {
        toast('The download link was missing. Please try again or message us for help.', 'bad');
        return;
      }
      window.location.assign(json.data.url);
    } finally {
      button.disabled = false;
      button.removeAttribute('aria-busy');
    }
  }, true);

  $('consent').addEventListener('change', async (event) => {
    const checkbox = event.currentTarget;
    const granted = checkbox.checked;
    checkbox.disabled = true;
    try {
      const { ok, json, error } = await call('/consent', {
        method: 'POST',
        body: JSON.stringify({ consent: granted, version: CONSENT_VERSION }),
      });
      if (!ok || json?.success !== true || json?.data?.publicConsent !== granted) {
        checkbox.checked = !granted;
        toast(json?.error || error || 'Could not save your choice. Please try again.', 'bad');
        return;
      }
      $('consentSaved').classList.toggle('hidden', !granted);
      toast(granted
        ? 'Thank you. Your permission has been saved.'
        : 'Permission withdrawn. Website posts from this album are unpublished.', 'good');
    } finally {
      checkbox.disabled = false;
    }
  });

  $('shareBtn').addEventListener('click', async () => {
    const data = { title: document.title, text: 'Our event photos', url: location.href };
    if (navigator.share) {
      try {
        await navigator.share(data);
        return;
      } catch (error) {
        if (error?.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(location.href);
      toast('Album link copied.', 'good');
    } catch {
      toast('Copy the album address from your browser bar to share it.', 'bad');
    }
  });

  $('togglePasscode').addEventListener('click', () => {
    const input = $('pin');
    const visible = input.type === 'text';
    input.type = visible ? 'password' : 'text';
    $('togglePasscode').innerHTML = `<i class="fas fa-eye${visible ? '' : '-slash'}" aria-hidden="true"></i>`;
    $('togglePasscode').setAttribute('aria-label', visible ? 'Show passcode' : 'Hide passcode');
    $('togglePasscode').title = visible ? 'Show passcode' : 'Hide passcode';
  });

  $('pinForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const input = $('pin');
    const button = $('unlockBtn');
    $('pinError').classList.add('hidden');
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');

    try {
      const { ok, json, error } = await call('/unlock', {
        method: 'POST',
        body: JSON.stringify({ passcode: input.value }),
      });
      if (!ok || !json?.data?.key) {
        $('pinError').textContent = json?.error || error || 'That passcode did not work. Please try again.';
        $('pinError').classList.remove('hidden');
        input.value = '';
        input.focus();
        return;
      }

      sessionKey = json.data.key;
      try {
        sessionStorage.setItem(keyStore, sessionKey);
      } catch {
        // The in-memory key keeps the album usable when session storage is disabled.
      }
      await load();
    } finally {
      button.disabled = false;
      button.removeAttribute('aria-busy');
    }
  });

  async function load() {
    show('loading');
    if (!token) {
      show('gone');
      return;
    }

    const { ok, status, json, error } = await call('');
    if (!ok) {
      if (status === 404) {
        show('gone');
        return;
      }
      $('problemText').textContent = json?.error || error || 'We couldn’t load your album. Please try again.';
      show('problem');
      return;
    }
    if (!json?.data) {
      $('problemText').textContent = 'The album service returned an unexpected response. Please try again.';
      show('problem');
      return;
    }

    if (json.data.locked) {
      setDeadline('lockedDeadline', 'lockedDeadlineTime', json.data.expiresAt);
      $('lockTitle').textContent = json.data.title || 'Your album';
      const credential = json.data.passcodeType === 'password' ? 'password' : 'PIN';
      $('pin').inputMode = credential === 'PIN' ? 'numeric' : 'text';
      $('pin').maxLength = credential === 'PIN' ? 8 : 128;
      $('lockSub').textContent = json.data.clientName
        ? `For ${json.data.clientName}. Enter your ${credential} to open it.`
        : `Enter your ${credential} to open it.`;
      show('locked');
      $('pin').focus();
      return;
    }

    try {
      renderAlbum(json.data);
    } catch (error) {
      console.error('The album response could not be displayed.', error);
      $('problemText').textContent = 'We received the album but couldn’t display its photos. Please try again or message us for help.';
      show('problem');
    }
  }

  $('retryBtn').addEventListener('click', load);
  load();
})();
