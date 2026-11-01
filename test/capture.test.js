import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { Miniflare, FormData, convertV4MiniflareOptions } from 'miniflare';

let mf, db, token;
const sha = s => createHash('sha256').update(s).digest('hex');
const call = (path, options) => mf.dispatchFetch('https://paperclip.test'+path,options);
before(async()=>{
  mf = new Miniflare(convertV4MiniflareOptions({ modules: true, scriptPath: new URL('../dist/_worker.js',import.meta.url).pathname, compatibilityDate:'2026-10-30', compatibilityFlags:['nodejs_compat'], d1Databases:{DB:'paperclip-test'} }));
  db = await mf.getD1Database('DB');
  const sql = await readFile(new URL('../server/migrations/0001_initial.sql',import.meta.url),'utf8');
  for (const statement of sql.split(';').map(s=>s.trim()).filter(Boolean)) await db.prepare(statement).run();
  const code='a'.repeat(32);
  await db.prepare('INSERT INTO pairing_codes(code_hash,expires_at) VALUES (?,?)').bind(sha(code),'2099-01-01T00:00:00.000Z').run();
  const pair=await call('/api/pair',{method:'POST',body:JSON.stringify({code})});assert.equal(pair.status,201);token=(await pair.json()).token;
});
after(async()=>{await mf?.dispose();});
const form = (id, text='https://example.org/a', image=null) => { const body=new FormData();body.set('id',id);body.set('text',text);body.set('title','A shared find');if(image)body.set('file',new Blob([image],{type:'image/png'}),'image.png');return body; };
const send = body => call('/api/capture',{method:'POST',headers:{Authorization:`Bearer ${token}`},body});

test('pairing codes are single-use and tokens are hashed',async()=>{
  assert.equal((await call('/api/pair',{method:'POST',body:JSON.stringify({code:'a'.repeat(32)})})).status,401);
  const device=await db.prepare('SELECT token_hash FROM devices').first();assert.equal(device.token_hash,sha(token));assert.notEqual(device.token_hash,token);
});
test('capture is authenticated, private and idempotent',async()=>{
  const id=randomUUID();assert.equal((await call('/api/capture',{method:'POST',body:form(id)})).status,401);
  const saved = await send(form(id)); assert.equal(saved.status,201,await saved.text());assert.equal((await send(form(id))).status,200);
  const row=await db.prepare('SELECT * FROM items WHERE id=?').bind(id).first();assert.equal(row.status,'pending');assert.equal(row.url,'https://example.org/a');
  assert.equal((await (await call('/api/items')).json()).items.length,0);
  assert.equal((await call('/media/'+id)).status,404);
  assert.equal((await db.prepare('SELECT count(*) n FROM items WHERE id=?').bind(id).first()).n,1);
});
test('original images round-trip after publication; pending bytes remain private',async()=>{
  const id=randomUUID();const image=Buffer.alloc(600000,83);Buffer.from([137,80,78,71,13,10,26,10]).copy(image);
  assert.equal((await send(form(id,'A diagram',image))).status,201);
  assert.equal((await db.prepare('SELECT count(*) n FROM image_chunks WHERE item_id=?').bind(id).first()).n,3);
  assert.equal((await call('/media/'+id)).status,404);
  await db.prepare("UPDATE items SET status='published', title='A diagram', category='images', tags='[\"design\"]', summary='A visual note', published_at=? WHERE id=?").bind(new Date().toISOString(),id).run();
  const response=await call('/media/'+id);assert.equal(response.status,200);assert.equal(response.headers.get('Content-Type'),'image/png');assert.deepEqual(Buffer.from(await response.arrayBuffer()),image);
  const items=(await (await call('/api/items')).json()).items;assert.equal(items.length,1);assert.deepEqual(items[0].tags,['design']);assert.equal(items[0].shared_text,undefined);
});
test('rejects executable image formats and oversized text',async()=>{
  assert.equal((await send(form(randomUUID(),'x',Buffer.from('<svg onload="alert(1)"></svg>')))).status,415);
  assert.equal((await send(form(randomUUID(),'x'.repeat(32001)))).status,400);
  assert.equal((await send(form(randomUUID(),''))).status,400);
});
test('revoked devices cannot write',async()=>{
  const localToken='z'.repeat(43);await db.prepare('INSERT INTO devices(id,token_hash,name,revoked_at) VALUES (?,?,?,?)').bind(randomUUID(),sha(localToken),'old','2026-01-01').run();
  assert.equal((await call('/api/capture',{method:'POST',headers:{Authorization:`Bearer ${localToken}`},body:form(randomUUID())})).status,401);
});
test('pagination never loses records sharing a capture timestamp',async()=>{
  const date='2026-01-01T00:00:00.000Z';
  await db.batch(Array.from({length:105},()=>db.prepare("INSERT INTO items(id,created_at,kind,status,title,category) VALUES (?,?,'text','published','Example','notes')").bind(randomUUID(),date)));
  const first=await (await call('/api/items')).json();assert.equal(first.items.length,100);assert.ok(first.next);
  const second=await (await call('/api/items?after='+encodeURIComponent(first.next))).json();assert.equal(second.items.length,6);assert.equal(second.next,null);assert.equal(new Set([...first.items,...second.items].map(x=>x.id)).size,106);
});
test('searches and tag filters cover the full archive and exclude private rows',async()=>{
  const id=randomUUID();await db.prepare("INSERT INTO items(id,created_at,kind,status,title,summary,category,tags) VALUES (?,'2020-01-01','link','published','A rare telescope','A reference guide','reference','[\"astronomy\"]')").bind(id).run();
  const data=await (await call('/api/items?q=rare+telescope&tag=astronomy&category=reference')).json();assert.deepEqual(data.items.map(x=>x.id),[id]);assert.ok(data.categories.includes('notes'));
  assert.equal((await (await call('/api/items?q='+encodeURIComponent("' OR 1=1 --"))).json()).items.length,0);
  assert.equal((await (await call('/api/items?q=A+shared+find')).json()).items.length,0);
});
