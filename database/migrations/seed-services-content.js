/**
 * Move the hardcoded service content into the database, where it can be edited.
 *
 * WHY: service-detail.html carries an inline SERVICES_DATA object with packages,
 * features and FAQs for nine services, and merges it in whenever the API returns
 * a service with none. Production has exactly that shape — ten services, one
 * package between them, zero features, zero FAQs — so almost everything a
 * visitor reads on a service page today, including every price, comes from that
 * hardcoded object. The client cannot edit it from the dashboard, which is why
 * editing prices there appeared to do nothing.
 *
 * This reads that object out of the page and writes it into `services` and
 * `service_packages`, so the site keeps showing exactly what it shows now and
 * the dashboard becomes the place to change it. The fallback merge is removed
 * in the same commit — after this runs there is nothing left for it to add.
 *
 * The prices seeded here are whatever the fallback has been publishing. They
 * are now editable and SHOULD BE REVIEWED — this script does not know whether
 * they are current, only that they are what the website has been quoting.
 *
 * Idempotent: services are matched on slug, packages on (service, name). Never
 * overwrites a package price that already exists in the database — a real price
 * the owner set outranks a hardcoded one.
 *
 *   node database/migrations/seed-services-content.js           (dry run)
 *   node database/migrations/seed-services-content.js --commit  (writes)
 */
const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT    = path.join(__dirname, '../..');
const BACKEND = path.join(ROOT, 'backened');
const { createClient } = require(path.join(BACKEND, 'node_modules/@supabase/supabase-js'));

const env = Object.fromEntries(
  fs.readFileSync(path.join(BACKEND, '.env'), 'utf8')
    .split(/\r?\n/)
    .filter(l => l && !l.startsWith('#') && l.includes('='))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
);

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

const COMMIT = process.argv.includes('--commit');

// Pull the object literal out of the page rather than keeping a second copy of
// it here — a copy would be the same mistake this script exists to undo.
function readFallback() {
  const src = fs.readFileSync(path.join(ROOT, 'frontend/service-detail.html'), 'utf8');
  const start = src.indexOf('const SERVICES_DATA = {');
  if (start === -1) throw new Error('SERVICES_DATA not found — has it already been removed?');
  const open = src.indexOf('{', start);

  let depth = 0, end = -1, inStr = null;
  for (let i = open; i < src.length; i++) {
    const c = src[i], prev = src[i - 1];
    if (inStr) { if (c === inStr && prev !== '\\') inStr = null; continue; }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end === -1) throw new Error('Could not find the end of SERVICES_DATA');
  return vm.runInNewContext('(' + src.slice(open, end + 1) + ')');
}

(async () => {
  const fallback = readFallback();
  const slugs = Object.keys(fallback);
  console.log(`Read ${slugs.length} services from the page fallback\n`);

  const { data: services, error } = await supabase.from('services').select('id, slug, name, features, faqs');
  if (error) throw error;
  const bySlug = Object.fromEntries(services.map(s => [s.slug, s]));

  const plan = { features: [], faqs: [], packages: [], missing: [], curated: [] };

  for (const slug of slugs) {
    const fb  = fallback[slug];
    const svc = bySlug[slug];
    if (!svc) { plan.missing.push(slug); continue; }

    if (!(svc.features || []).length && (fb.features || []).length) {
      plan.features.push({ id: svc.id, slug, value: fb.features });
    }
    if (!(svc.faqs || []).length && (fb.faqs || []).length) {
      plan.faqs.push({ id: svc.id, slug, value: fb.faqs });
    }

    const { data: existing } = await supabase.from('service_packages')
      .select('id, name, price').eq('service_id', svc.id);

    // A service with even one package is one the owner has started pricing
    // himself, and the page is already showing his figures rather than the
    // fallback. Adding the hardcoded three alongside would change what a
    // visitor sees — the one thing this migration must not do.
    if ((existing || []).length) { plan.curated.push(slug); continue; }

    (fb.packages || []).forEach((p, i) => {
      plan.packages.push({
        service_id: svc.id, slug,
        name: p.name,
        price: p.price ?? null,
        duration: p.duration || null,
        features: p.features || [],
        is_popular: !!p.popular,
        is_active: true,
        display_order: (i + 1) * 10,
        updated_by: 'seed-services-content',
      });
    });
  }

  console.log(`features to fill : ${plan.features.length}  (${plan.features.map(f => f.slug).join(', ') || '—'})`);
  console.log(`faqs to fill     : ${plan.faqs.length}  (${plan.faqs.map(f => f.slug).join(', ') || '—'})`);
  console.log(`packages to add  : ${plan.packages.length}`);
  if (plan.curated.length) console.log(`already priced   : ${plan.curated.join(', ')} (left untouched)`);
  if (plan.missing.length) console.log(`no such service  : ${plan.missing.join(', ')}`);

  // One package per service may be flagged popular (a partial unique index), so
  // drop the flag on any service that already has one.
  for (const p of plan.packages.filter(x => x.is_popular)) {
    const { data: pop } = await supabase.from('service_packages')
      .select('id').eq('service_id', p.service_id).eq('is_popular', true).maybeSingle();
    if (pop) p.is_popular = false;
  }

  if (!COMMIT) { console.log('\nDry run — nothing written. Re-run with --commit.'); return; }

  for (const f of plan.features) {
    const { error: e } = await supabase.from('services').update({ features: f.value }).eq('id', f.id);
    if (e) console.error('features', f.slug, e.message);
  }
  for (const f of plan.faqs) {
    const { error: e } = await supabase.from('services').update({ faqs: f.value }).eq('id', f.id);
    if (e) console.error('faqs', f.slug, e.message);
  }
  if (plan.packages.length) {
    const rows = plan.packages.map(({ slug, ...row }) => row);
    const { error: e } = await supabase.from('service_packages').insert(rows);
    if (e) console.error('packages', e.message);
  }
  console.log('\nWritten.');
})().catch(e => { console.error(e); process.exit(1); });
