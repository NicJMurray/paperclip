import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { Miniflare, FormData, Request, convertV4MiniflareOptions } from 'miniflare';

let mf, db, token;
const sha = s => createHash('sha256').update(s).digest('hex');
const call = async (path, options) => {
  const request = new Request('https://paperclip.test' + path, options);
  // Finish serializing multipart bodies before an early authentication response
  // can close Miniflare's local request stream.
  return mf.dispatchFetch(request.url, {
    method: request.method,
    headers: request.headers,
    body: request.body ? await request.arrayBuffer() : undefined,
  });
};
before(async()=>{
  mf = new Miniflare(convertV4MiniflareOptions({ modules: true, scriptPath: new URL('../dist/_worker.js',import.meta.url).pathname, compatibilityDate:'2026-10-30', compatibilityFlags:['nodejs_compat'], d1Databases:{DB:'paperclip-test'} }));
  db = await mf.getD1Database('DB');
  for (const file of ['0001_initial.sql','0002_queue_removal.sql','0004_shared_files.sql']) {
    const sql = await readFile(new URL('../server/migrations/'+file,import.meta.url),'utf8');
    for (const statement of sql.split(';').map(s=>s.trim()).filter(Boolean)) await db.prepare(statement).run();
  }
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
test('authenticated links publish immediately without a title or a supported source',async()=>{
  const url='https://example.org/remark.pdf';
  const id=randomUUID(), body=form(id,url);body.delete('title');
  assert.equal((await call('/api/capture',{method:'POST',body})).status,401);
  assert.equal((await db.prepare('SELECT id FROM items WHERE id=?').bind(id).first()),null);
  const saved = await send(body); assert.equal(saved.status,201,await saved.text());
  assert.equal((await send(body)).status,200);
  const row=await db.prepare('SELECT * FROM items WHERE id=?').bind(id).first();
  assert.equal(row.status,'published');assert.equal(row.url,url);
  assert.equal(row.title,url);assert.equal(row.summary,null);assert.ok(row.published_at);
  const items=(await (await call('/api/items?q=remark.pdf')).json()).items;
  assert.deepEqual(items.map(item=>item.id),[id]);
  assert.equal(items[0].shared_text,undefined);
  assert.equal((await privateQueue().then(r=>r.json())).total,0);
  assert.equal((await call('/media/'+id)).status,404);
});
test('shared notes retain their original title and text',async()=>{
  const id=randomUUID(), text='An original note.\nA second line.';
  const saved=await send(form(id,text));assert.equal(saved.status,201);
  const items=(await (await call('/api/items?category=notes&q=original')).json()).items;
  assert.deepEqual(items.map(item=>[item.id,item.title,item.summary.replaceAll('\r\n','\n')]),[[id,'A shared find',text]]);
});
test('original images are available as soon as the upload succeeds',async()=>{
  const id=randomUUID();
  const image=Buffer.alloc(600000,83);Buffer.from([137,80,78,71,13,10,26,10]).copy(image);
  const body=form(id,'An image shared with https://example.org/diagram',image);
  assert.equal((await send(body)).status,201);
  assert.equal((await send(body)).status,200);
  assert.equal((await db.prepare('SELECT count(*) n FROM image_chunks WHERE item_id=?').bind(id).first()).n,3);
  const response=await call('/media/'+id);assert.equal(response.status,200);assert.equal(response.headers.get('Content-Type'),'image/png');assert.deepEqual(Buffer.from(await response.arrayBuffer()),image);
  const items=(await (await call('/api/items?q=diagram')).json()).items;
  assert.deepEqual(items.map(item=>[item.id,item.kind,item.url,item.image_url]),[[id,'image','https://example.org/diagram','/media/'+id]]);
});
test('standalone images publish without a title or a caption',async()=>{
  const image=Buffer.from([137,80,78,71,13,10,26,10]);
  const id=randomUUID(), body=form(id,'',image);body.delete('title');
  assert.equal((await send(body)).status,201);
  const items=(await (await call('/api/items?category=images')).json()).items;
  assert.deepEqual(items.map(item=>[item.id,item.title,item.summary]),[[id,'Image',null]]);
});
test('shared documents publish original bytes with their name, caption and link', async () => {
  const id = randomUUID(), url = 'https://example.org/source';
  const bytes = Buffer.alloc(600000, 65);
  Buffer.from('%PDF-1.7').copy(bytes);
  const body = form(id, 'Reference copy: ' + url);
  body.set('file', new Blob([bytes], {type: 'application/pdf'}), 'attachment');
  body.set('file_name', 'Résumé.pdf');

  assert.equal((await send(body)).status, 201);
  assert.equal((await send(body)).status, 200);
  const items = await (await call('/api/items?category=files&q=' + encodeURIComponent('Résumé.pdf'))).json();
  assert.deepEqual(items.items.map(item => [item.id, item.kind, item.title, item.url, item.file_name, item.file_url]),
    [[id, 'file', 'A shared find', url, 'Résumé.pdf', '/files/' + id]]);
  const download = await call('/files/' + id);
  assert.equal(download.status, 200);
  assert.equal(download.headers.get('Content-Type'), 'application/octet-stream');
  assert.match(download.headers.get('Content-Disposition'), /^attachment;.*R%C3%A9sum%C3%A9\.pdf$/);
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes);
  assert.equal((await call('/media/' + id)).status, 404);
});
test('non-image attachments stay download-only and unpublished files stay private', async () => {
  const id = randomUUID();
  const body = form(id, '');
  body.delete('title');
  body.set('file_name', 'example.html');
  body.set('file', new Blob(['<h1>An HTML file</h1>'], {type: 'image/png'}), 'attachment');

  assert.equal((await send(body)).status, 201);
  const download = await call('/files/' + id);
  assert.equal(download.headers.get('Content-Type'), 'application/octet-stream');
  assert.equal(download.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(await download.text(), '<h1>An HTML file</h1>');
  assert.equal((await call('/media/' + id)).status, 404);
  await db.prepare("UPDATE items SET status = 'held' WHERE id = ?").bind(id).run();
  assert.equal((await call('/files/' + id)).status, 404);
  assert.equal((await (await call('/api/items?q=example.html')).json()).items.length, 0);
  await discard(id);
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
  const first=await (await call('/api/items?q=Example&category=notes')).json();assert.equal(first.items.length,100);assert.ok(first.next);
  const second=await (await call('/api/items?q=Example&category=notes&after='+encodeURIComponent(first.next))).json();assert.equal(second.items.length,5);assert.equal(second.next,null);assert.equal(new Set([...first.items,...second.items].map(x=>x.id)).size,105);
});
test('searches and tag filters cover the full archive and exclude private rows',async()=>{
  const id=randomUUID();await db.prepare("INSERT INTO items(id,created_at,kind,status,title,summary,category,tags) VALUES (?,'2020-01-01','link','published','A rare telescope','A reference guide','reference','[\"astronomy\"]')").bind(id).run();
  const data=await (await call('/api/items?q=rare+telescope&tag=astronomy&category=reference')).json();assert.deepEqual(data.items.map(x=>x.id),[id]);assert.ok(data.categories.includes('notes'));
  assert.equal((await (await call('/api/items?q='+encodeURIComponent("' OR 1=1 --"))).json()).items.length,0);
  assert.equal((await (await call('/api/items?q=example.org%2Fqueue')).json()).items.length,0);
});

const privateQueue = () => call('/api/queue',{headers:{Authorization:`Bearer ${token}`}});
const discard = id => call('/api/queue/'+id,{method:'DELETE',headers:{Authorization:`Bearer ${token}`}});
test('private queue returns only the latest three unpublished items',async()=>{
  assert.equal((await call('/api/queue')).status,401);
  const baseline=(await db.prepare("SELECT count(*) n FROM items WHERE status IN ('pending','held')").first()).n;
  const ids=Array.from({length:5},()=>randomUUID());
  await db.batch(ids.map((id,i)=>db.prepare("INSERT INTO items(id,created_at,kind,status,shared_title,url) VALUES (?,?,'link',?,?,'https://example.org/queue')").bind(id,`2099-01-0${i+1}T00:00:00.000Z`,i===4?'held':'pending','Source title '+i)));
  const result=await (await privateQueue()).json();assert.deepEqual(result.items.map(x=>x.id),ids.slice(2).reverse());assert.equal(result.total,baseline+5);
  assert.equal(result.items[0].status,'held');assert.equal(result.items[0].title,'Source title 4');assert.equal(result.items[0].shared_text,undefined);assert.equal(result.items[0].image_preview,undefined);
  assert.equal((await (await call('/api/items?q=example.org%2Fqueue')).json()).items.length,0);
});
test('removing a waiting image deletes bytes and prevents upload retries recreating it',async()=>{
  const id=randomUUID(),image=Buffer.from([137,80,78,71,13,10,26,10,0,0,0]);
  await db.batch([
    db.prepare("INSERT INTO items(id,kind,status,mime_type) VALUES (?,'image','held','image/png')").bind(id),
    db.prepare('INSERT INTO image_chunks(item_id,part,data) VALUES (?,0,?)').bind(id,image.toString('base64')),
  ]);
  assert.equal((await call('/media/'+id)).status,404);
  assert.equal((await call('/api/queue/'+id,{method:'DELETE'})).status,401);
  assert.ok(await db.prepare('SELECT id FROM items WHERE id=?').bind(id).first());
  assert.equal((await discard(id)).status,200);assert.equal((await discard(id)).status,200);
  assert.equal(await db.prepare('SELECT id FROM items WHERE id=?').bind(id).first(),null);
  assert.equal((await db.prepare('SELECT count(*) n FROM image_chunks WHERE item_id=?').bind(id).first()).n,0);
  assert.equal((await send(form(id,'',image))).status,410);
});
test('offline removals are remembered before an upload arrives',async()=>{
  const id=randomUUID();assert.equal((await discard(id)).status,200);assert.equal((await send(form(id))).status,410);
  assert.equal(await db.prepare('SELECT id FROM items WHERE id=?').bind(id).first(),null);
  assert.equal((await db.prepare("UPDATE items SET status='published' WHERE id=? AND status='pending'").bind(id).run()).meta.changes,0);
});
test('queue removal cannot delete an already published item',async()=>{
  const id=randomUUID();await db.prepare("INSERT INTO items(id,kind,status,title) VALUES (?,'text','published','Already published')").bind(id).run();
  assert.equal((await discard(id)).status,409);assert.equal((await db.prepare('SELECT status FROM items WHERE id=?').bind(id).first()).status,'published');
  assert.equal(await db.prepare('SELECT id FROM discarded_items WHERE id=?').bind(id).first(),null);
});
test('racing removal and capture either discard the item or publish it with its image',async()=>{
  for(let i=0;i<4;i++){
    const id=randomUUID(),image=Buffer.from([137,80,78,71,13,10,26,10,0,0,0]);
    const [capture,removed]=await Promise.all([send(form(id,'Race test',image)),discard(id)]);
    const row=await db.prepare('SELECT status FROM items WHERE id=?').bind(id).first();
    const {n}=await db.prepare('SELECT count(*) n FROM image_chunks WHERE item_id=?').bind(id).first();
    if (removed.status===200) {
      assert.equal(capture.status,410);assert.equal(row,null);assert.equal(n,0);
    } else {
      assert.equal(removed.status,409);assert.equal(capture.status,201);assert.equal(row.status,'published');assert.equal(n,1);
    }
  }
});
