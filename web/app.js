const state = { items: [], categories: [], category: 'all', tag: '', query: '', cursor: null, busy: false, failed: false, serial: 0 };
const $ = id => document.getElementById(id);
const label = value => value.charAt(0).toUpperCase() + value.slice(1);
const element = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text) node.textContent = text; return node; };
function safeURL(value) { try { const u = new URL(value); return ['https:','http:'].includes(u.protocol) && !u.username && !u.password ? u : null; } catch { return null; } }
function card(item) {
  const article = element('article','card');
  if (item.kind === 'image') {
    const link = element('a','image-link'); link.href = `/media/${encodeURIComponent(item.id)}`; link.target = '_blank'; link.rel = 'noopener noreferrer';
    const img = element('img'); img.src = link.href; img.alt = item.summary || item.title || 'Saved image'; img.loading = 'lazy'; img.decoding = 'async'; link.append(img); article.append(link);
  }
  const content = element('div','card-content'), head = element('div','card-heading');
  head.append(element('span','category',item.category || 'other')); const url = safeURL(item.url);
  if (url) head.append(element('span','arrow','↗'));
  const h2 = element('h2');
  if (url) { const a = element('a','',item.title || url.hostname); a.href = url.href; a.target = '_blank'; a.rel = 'noopener noreferrer'; h2.append(a); } else h2.textContent = item.title || 'A small discovery';
  content.append(head,h2);
  if (item.summary) content.append(element('p','',item.summary));
  const tags = element('div','tags');
  for (const tag of (Array.isArray(item.tags) ? item.tags : [])) { const button = element('button','tag',`#${tag}`); button.addEventListener('click',()=>{state.tag=tag;void load(true);}); tags.append(button); }
  content.append(tags);
  const source = element('div','source'); const date = new Date(item.created_at);
  source.append(element('span','',url ? url.hostname.replace(/^www\./,'') : item.kind === 'image' ? 'A saved image' : 'A saved note'),element('span','',Number.isNaN(+date) ? '' : date.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})));
  content.append(source); article.append(content); return article;
}
function render() {
  const categories = state.categories;
  $('categories').replaceChildren();
  for (const category of ['all',...categories]) { const b = element('button',state.category === category ? 'active' : '',category === 'all' ? 'Everything' : label(category)); b.setAttribute('aria-pressed',String(state.category === category)); b.addEventListener('click',()=>{state.category=category;void load(true);}); $('categories').append(b); }
  const words = state.query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const items = state.items.filter(x=>(state.category === 'all' || x.category === state.category) && (!state.tag || x.tags?.includes(state.tag)) && words.every(word=>[x.title,x.summary,x.url,...(x.tags || [])].join(' ').toLowerCase().includes(word)));
  $('items').replaceChildren(...items.map(card));
  $('count').textContent = `${items.length} ${items.length === 1 ? 'thing' : 'things'}${state.tag ? ` tagged #${state.tag}` : ''}${state.cursor ? ' loaded' : ' worth keeping'}`;
  $('clear').hidden = !(state.query || state.tag || state.category !== 'all');
  $('message').hidden = items.length > 0;
  $('message').replaceChildren();
  if (!items.length) {
    const filtered = state.query || state.tag || state.category !== 'all';
    $('message').append(element('strong','', state.failed ? 'The collection is taking a moment.' : !filtered ? 'A place for the good finds.' : 'No matches this time.'),element('span','',state.failed ? 'Please reload to try again.' : !filtered ? 'The first collection will appear here after the next weekly sort.' : 'Try another search, or clear your filters.'));
  }
  $('more').hidden = !state.cursor; $('more').disabled = state.busy; $('more').textContent = state.busy ? 'Loading…' : 'Load more';
}
async function load(reset = false) {
  if (reset) { state.serial++; state.items=[]; state.cursor=null; }
  else if (state.busy) return;
  const serial = state.serial; state.busy = true; $('more').disabled = true;
  try {
    const params = new URLSearchParams(); if (state.cursor) params.set('after',state.cursor); if (state.query) params.set('q',state.query); if (state.tag) params.set('tag',state.tag); if (state.category !== 'all') params.set('category',state.category);
    const response = await fetch('/api/items?'+params,{cache:'no-store'});
    if (!response.ok) throw new Error('Unavailable');
    const data = await response.json(); if (serial !== state.serial) return; state.items.push(...data.items); state.categories=data.categories || []; state.cursor = data.next; state.failed = false;
  } catch { if (serial === state.serial) state.failed = true; }
  finally { if (serial === state.serial) {state.busy = false; render();} }
}
let searchTimer;
$('search').addEventListener('input',event=>{state.query=event.target.value;clearTimeout(searchTimer);searchTimer=setTimeout(()=>void load(true),180);});
$('clear').addEventListener('click',()=>{state.category='all';state.tag='';state.query='';$('search').value='';void load(true);});
$('more').addEventListener('click',()=>void load());
void load();
