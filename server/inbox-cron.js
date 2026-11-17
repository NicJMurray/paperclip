const BATCH = 12;
const NOTE = 'Cloudflare inbox curator';
const safeQuery = /^(utm_[a-z_]+|r|wprov|sharetype|v|t|si|feature|s)$/i;
const categories = [
  [/^(?:[a-z-]+\.)?wikipedia\.org$/, /^\/wiki\/[^/:]+$/, 'reference', ['wikipedia','reference']],
  [/^(?:www\.)?ft\.com$/, /^\/content\/[a-f0-9-]+$/i, 'articles', ['financial-times','article']],
  [/^(?:[a-z0-9-]+\.)?substack\.com$/, /^\/(?:pub\/[\w-]+\/)?p\/[\w%-]+\/?$|^\/@[\w.-]+\/note\/c-\d+\/?$/, 'articles', ['substack','reading']],
  [/^github\.com$/, /^\/[\w.-]+\/[\w.-]+\/?$/, 'tools', ['github','software']],
  [/^(?:www\.)?youtube\.com$/, /^\/(?:watch|shorts\/[\w-]+)$/, 'videos', ['youtube','video']],
  [/^youtu\.be$/, /^\/[\w-]+$/, 'videos', ['youtube','video']],
  [/^(?:www\.)?(?:x|twitter)\.com$/, /^\/\w+\/status\/\d+$/, 'notes', ['social','post']],
  [/^(?:www\.)?theguardian\.com$/, /^\/[\w-]+\/\d{4}\/[a-z]{3}\/\d{2}\/[\w-]+$/, 'articles', ['guardian','article']],
  [/^(?:www\.)?bbc\.(?:co\.uk|com)$/, /^\/news\/(?:articles\/[\w]+|[\w-]+-\d+)$/, 'articles', ['bbc','article']],
  [/^arxiv\.org$/, /^\/abs\/[\w./-]+$/, 'reference', ['arxiv','research']],
  [/^hackerbooks\.org$/, /^\/$/, 'tools', ['books','software']],
  [/^karpathy\.bearblog\.dev$/, /^\/[\w-]+\/?$/, 'articles', ['blog','article']],
];
const privateText = /\b(?:do not (?:share|publish)|don['’]t (?:share|publish)|private link|magic link|one.time (?:code|password)|reset (?:your )?password|api key|access token|invitation code)\b/i;
const unavailable = /^(?:access denied|just a moment|page not found|attention required|forbidden|request blocked|verify you are human|sign in|log in|subscribe)(?:$|[\s:|!–—-])/i;

export function publicSource(value, base) {
  let url;
  try { url = new URL(value, base); } catch { return null; }
  if (url.protocol !== 'https:' || url.port || url.username || url.password || url.hash ||
      [...url.searchParams].some(([key, value]) => !safeQuery.test(key) || !/^[\w .-]{0,100}$/.test(value))) return null;
  const source = categories.find(([host, path]) => host.test(url.hostname) && path.test(url.pathname));
  if (!source) return null;
  if (url.pathname === '/watch' && !/^[\w-]{11}$/.test(url.searchParams.get('v') ?? '')) return null;
  const canonical = new URL(url);
  canonical.search = url.pathname === '/watch' ? '?v=' + url.searchParams.get('v') : '';
  if (canonical.hostname === 'open.substack.com' && canonical.pathname.startsWith('/pub/')) {
    const [, , publisher, ...path] = canonical.pathname.split('/');
    canonical.hostname = publisher + '.substack.com';
    canonical.pathname = '/'+path.join('/');
  }
  return {url, canonical, category:source[2], tags:source[3]};
}

async function metadata(response) {
  if (!response.body) return {};
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let html = '', remaining = 96 * 1024;
  try {
    while (remaining > 0 && !/<\/head\s*>/i.test(html)) {
      const result = await reader.read();
      if (result.done) break;
      html += decoder.decode(result.value.subarray(0, remaining), {stream:true});
      remaining -= result.value.byteLength;
    }
  } finally { await reader.cancel().catch(() => {}); }
  const fields = new Map();
  let title = '';
  const meta = {element(el) {
    const key = (el.getAttribute('property') || el.getAttribute('name') || '').toLowerCase();
    const value = el.getAttribute('content');
    if (value && !fields.has(key)) fields.set(key, value);
  }};
  await new HTMLRewriter()
    .on('meta[content]', meta)
    .on('title', {text(t) { title += t.text; }})
    .transform(new Response(html)).text();
  const clean = value => (value || '').replace(/\s+/g, ' ').trim();
  const headline = clean(fields.get('og:title') || title);
  const summary = clean(fields.get('og:description') || fields.get('description'));
  const robots = [fields.get('robots'),response.headers.get('x-robots-tag')].filter(Boolean).join(',');
  if (/\bnoindex\b/i.test(robots) || unavailable.test(headline) || !headline ||
      privateText.test(headline) || privateText.test(summary)) return {};
  return {title:headline, summary:summary || null};
}

export async function curate(item, fetchPage = fetch) {
  if (privateText.test([item.shared_title,item.shared_text].join(' '))) return {reason:'Possible private or sensitive content.'};
  if (item.kind !== 'link') return {reason:'Standalone text or images need review.'};
  const source = publicSource(item.url);
  if (!source) return {reason:'Source link needs review before publication.'};
  let target = source.canonical;
  const signal = AbortSignal.timeout(8000);
  for (let i=0;i<3;i++) {
    let response;
    try { response = await fetchPage(target.href, {redirect:'manual',signal,headers:{'User-Agent':'Paperclip curator (https://paperclip.njmurray.com/)',Accept:'text/html'}}); }
    catch { return null; }
    if ([301,302,303,307,308].includes(response.status)) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      const redirect = location && publicSource(location, target);
      if (!redirect) return {reason:'Source redirected to a link that needs review.'};
      target = redirect.canonical;
      continue;
    }
    if (response.status === 429 || response.status >= 500) {
      await response.body?.cancel();
      return null;
    }
    if (!response.ok || !response.headers.get('content-type')?.toLowerCase().includes('text/html')) {
      await response.body?.cancel();
      return {reason:'A public source headline could not be verified.'};
    }
    const fields = await metadata(response).catch(() => null);
    if (fields === null) return null;
    if (!fields.title) return {reason:'A public source headline could not be verified.'};
    return {...fields,category:source.category,tags:source.tags,canonical:target.href};
  }
  return {reason:'Source returned too many redirects.'};
}

export async function sortInbox(db, fetchPage = fetch) {
  const {results} = await db.prepare("SELECT id,kind,url,shared_title,shared_text FROM items WHERE status='pending' ORDER BY created_at,id LIMIT ?").bind(BATCH).all();
  const now = new Date().toISOString();
  const decisions = await Promise.all(results.map(item => curate(item, fetchPage)));
  const duplicate = "EXISTS (SELECT 1 FROM items p WHERE p.status='published' AND (p.url=? OR substr(p.url,1,instr(p.url||'?','?')-1)=?)) OR EXISTS (SELECT 1 FROM feed_items p WHERE p.url=?)";
  const work = [];
  for (const [i, item] of results.entries()) {
    const decision = decisions[i];
    if (!decision) continue;
    if (decision.reason) {
      work.push({kind:'held', statement:db.prepare("UPDATE items SET status='held',review_note=? WHERE id=? AND status='pending'").bind(decision.reason,item.id)});
      continue;
    }
    const match = [item.url,decision.canonical,decision.canonical];
    work.push({kind:'held', statement:db.prepare("UPDATE items SET status='held',review_note='Already published.' WHERE id=? AND status='pending' AND ("+duplicate+")").bind(item.id,...match)});
    work.push({kind:'published', statement:db.prepare("UPDATE items SET status='published', title=?, summary=?, category=?, tags=?, published_at=?, review_note=NULL WHERE id=? AND status='pending'").bind(decision.title,decision.summary,decision.category,JSON.stringify(decision.tags),now,item.id)});
  }
  const changes = work.length ? await db.batch(work.map(x=>x.statement)) : [];
  const count = kind => changes.reduce((sum, result, i) => sum + (work[i].kind === kind ? result.meta.changes : 0), 0);
  const published = count('published'), held = count('held');
  const deferred = decisions.filter(x=>x===null).length;
  await db.prepare('INSERT INTO curation_runs (id,completed_at,published_count,held_count,note) VALUES (?,?,?,?,?)')
    .bind(crypto.randomUUID(),now,published,held,NOTE+'; retry='+deferred).run();
  return {published,held,deferred};
}

export default {async scheduled(_event, env) {
  console.info(JSON.stringify({event:'inbox_curated', ...await sortInbox(env.DB)}));
}};
