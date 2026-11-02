import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const data = process.env.DATA_DIR || path.join(root, 'data');
mkdirSync(data, { recursive: true });
const db = new DatabaseSync(path.join(data, 'brief.sqlite'));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS workspaces(id TEXT PRIMARY KEY, name TEXT NOT NULL, demo INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS users(email TEXT PRIMARY KEY, workspace TEXT NOT NULL REFERENCES workspaces(id), salt TEXT NOT NULL, password TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, workspace TEXT NOT NULL REFERENCES workspaces(id), expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY, workspace TEXT NOT NULL REFERENCES workspaces(id), title TEXT NOT NULL, client TEXT NOT NULL, email TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '', amount INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL, due TEXT NOT NULL DEFAULT '', share TEXT UNIQUE, decision TEXT, created TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY AUTOINCREMENT, workspace TEXT NOT NULL REFERENCES workspaces(id), text TEXT NOT NULL, created TEXT NOT NULL);`);
const id = () => randomBytes(16).toString('hex');
const now = () => new Date().toISOString();
const statuses = ['new', 'progress', 'review', 'won'];
const stmt = (sql, ...args) => db.prepare(sql).run(...args);
const one = (sql, ...args) => db.prepare(sql).get(...args);
const all = (sql, ...args) => db.prepare(sql).all(...args);
function event(w, text) { stmt('INSERT INTO events(workspace,text,created) VALUES(?,?,?)', w, text, now()); }
function session(res, w) {
  const token = randomBytes(32).toString('hex');
  stmt('INSERT INTO sessions VALUES(?,?,?)', createHash('sha256').update(token).digest('hex'), w, Date.now() + 7 * 86400000);
  res.setHeader('Set-Cookie', `brief_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800${process.env.COOKIE_SECURE === '1' ? '; Secure' : ''}`);
}
function workspace(req) {
  const token = /(?:^|;\s*)brief_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
  if (!token) return null;
  return one('SELECT w.* FROM sessions s JOIN workspaces w ON w.id=s.workspace WHERE s.token=? AND s.expires>?', createHash('sha256').update(token).digest('hex'), Date.now());
}
function json(res, code, body) { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); }
function fail(code, message) { throw Object.assign(new Error(message), { code }); }
async function body(req) {
  let data = ''; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > 32768) fail(413, 'Слишком большой запрос'); data += chunk; }
  try { const v = JSON.parse(data || '{}'); if (!v || typeof v !== 'object' || Array.isArray(v)) throw Error(); return v; } catch { fail(400, 'Некорректный JSON'); }
}
function text(v, max, required = false) { if (typeof v !== 'string' || v.length > max || (required && !v.trim())) fail(400, 'Проверьте заполненные поля'); return v.trim(); }
function fields(b) {
  const amount = Number(b.amount || 0);
  if (!Number.isSafeInteger(amount) || amount < 0 || amount > 1e12) fail(400, 'Укажите сумму целым числом от 0 до 1 трлн');
  const due = text(b.due || '', 10);
  if (due && (!/^\d{4}-\d{2}-\d{2}$/.test(due) || !Number.isFinite(Date.parse(due)) || new Date(due).toISOString().slice(0,10) !== due)) fail(400, 'Проверьте дату');
  const email = text(b.email || '', 254);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, 'Проверьте email клиента');
  return { title: text(b.title, 160, true), client: text(b.client, 100, true), email, description: text(b.description || '', 5000), amount, due };
}
function addProject(w, p, status = 'new') {
  const key = id(); stmt('INSERT INTO projects(id,workspace,title,client,email,description,amount,status,due,created) VALUES(?,?,?,?,?,?,?,?,?,?)', key,w,p.title,p.client,p.email || '',p.description || '',p.amount,status,p.due || '',now()); return key;
}
const attempts = new Map();
function limit(req, kind, max) {
  const key = `${req.socket.remoteAddress}:${kind}`; const time = Date.now();
  let entry = attempts.get(key); if (!entry || entry.until < time) { entry = { count: 0, until: time + 600000 }; attempts.set(key,entry); }
  if (++entry.count > max) fail(429, 'Слишком много попыток. Попробуйте через 10 минут.');
}
const cleanup = setInterval(() => { stmt('DELETE FROM sessions WHERE expires<?', Date.now()); for (const [key,v] of attempts) if (v.until < Date.now()) attempts.delete(key); }, 600000); cleanup.unref();

const server = http.createServer(async (req,res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  try {
    const url = new URL(req.url, 'http://localhost'); const route = url.pathname;
    if (!['GET','HEAD','OPTIONS'].includes(req.method)) {
      if (req.headers['sec-fetch-site'] === 'cross-site') fail(403, 'Запрос с другого сайта запрещён');
      if (req.headers.origin) { let origin; try { origin = new URL(req.headers.origin); } catch { fail(403, 'Некорректный источник'); } if (origin.host !== req.headers.host) fail(403, 'Запрос с другого сайта запрещён'); }
      if (!(req.headers['content-type'] || '').startsWith('application/json')) fail(415, 'Ожидается application/json');
    }
    if (route === '/api/health' && req.method === 'GET') return json(res,200,{ok: one('SELECT 1 AS ok').ok === 1});
    if (route === '/api/config' && req.method === 'GET') return json(res,200,{realAccountsEnabled:process.env.ENABLE_REAL_ACCOUNTS==='1'});
    if (route === '/api/demo' && req.method === 'POST') {
      limit(req,'demo',20); const w=id(); stmt('INSERT INTO workspaces VALUES(?,?,1)',w,'Forma Studio');
      const date = offset => new Date(Date.now()+offset*86400000).toISOString().slice(0,10);
      [
        ['Сайт для нового бренда','NØRD',240000,'new',8,'Интернет-магазин предметов интерьера. Каталог до 50 товаров, адаптивный дизайн и интеграция оплаты.'],
        ['Айдентика кофейни','SLOW Coffee',85000,'new',12,'Логотип, цветовая палитра, упаковка и короткий гайд по фирменному стилю.'],
        ['Редизайн личного кабинета','Orbit',180000,'progress',5,'Исследование пользовательского пути, прототип и дизайн 12 основных экранов.'],
        ['Лендинг летней коллекции','Linen',120000,'review',3,'Арт-дирекшн и адаптивный лендинг. Два раунда правок. Срок — 14 рабочих дней.'],
        ['Дизайн-система','Capsule',320000,'won',20,'Компоненты, токены и документация для продуктовой команды.'],
        ['Сайт архитектурного бюро','ARCH / 01',210000,'progress',15,'Портфолио проектов, страница команды и форма обращения.']
      ].forEach(([title,client,amount,status,offset,description])=>addProject(w,{title,client,amount,due:date(offset),description},status));
      event(w,'Создано ваше демо-пространство'); session(res,w); return json(res,201,{ok:true});
    }
    if (['/api/register','/api/login'].includes(route) && req.method === 'POST') {
      if(process.env.ENABLE_REAL_ACCOUNTS !== '1') fail(403,'Регистрация и вход отключены до настройки размещения в РФ и документов оператора. Используйте демо с вымышленными данными.');
      limit(req,'auth',15); const b=await body(req); const email=text(b.email,254,true).toLowerCase();
      if(typeof b.password !== 'string' || b.password.length>128) fail(400,'Проверьте пароль');
      const password=b.password;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length<10) fail(400,'Нужны корректный email и пароль от 10 символов');
      if (route === '/api/register') {
        const name=text(b.name,100,true); if(one('SELECT email FROM users WHERE email=?',email)) fail(409,'Этот email уже зарегистрирован');
        const w=id(), salt=id(), hash=scryptSync(password,salt,64).toString('hex');
        db.exec('BEGIN'); try { stmt('INSERT INTO workspaces VALUES(?,?,0)',w,name); stmt('INSERT INTO users VALUES(?,?,?,?)',email,w,salt,hash); db.exec('COMMIT'); } catch(e) { db.exec('ROLLBACK'); throw e; }
        event(w,'Рабочее пространство создано'); session(res,w); return json(res,201,{ok:true});
      }
      const user=one('SELECT * FROM users WHERE email=?',email);
      const hash=scryptSync(password,user?.salt || 'missing-user-salt',64);
      if(!user || !timingSafeEqual(hash,Buffer.from(user.password,'hex'))) fail(401,'Неверный email или пароль');
      session(res,user.workspace); return json(res,200,{ok:true});
    }
    if(route.startsWith('/api/public/')) {
      const token=route.split('/')[3]; if (!/^[a-f0-9]{48}$/.test(token || '')) fail(404,'Предложение не найдено');
      const p=one('SELECT p.*,w.name AS studio FROM projects p JOIN workspaces w ON w.id=p.workspace WHERE p.share=?',token);
      if (!p) fail(404,'Ссылка недействительна или отозвана');
      if(req.method==='GET' && route===`/api/public/${token}`) return json(res,200,{title:p.title,client:p.client,description:p.description,amount:p.amount,due:p.due,status:p.status,decision:p.decision,studio:p.studio});
      if(req.method==='POST' && route===`/api/public/${token}/approve`) {
        if(p.decision) fail(409,'Предложение уже принято');
        if(p.status !== 'review') fail(409,'Предложение сейчас не ожидает согласования');
        stmt("UPDATE projects SET status='won',decision=? WHERE id=?",now(),p.id); event(p.workspace,`${p.client} согласовал(а) «${p.title}»`); return json(res,200,{ok:true});
      }
      fail(404,'Маршрут не найден');
    }
    if(route.startsWith('/api/')) {
      const w=workspace(req); if(!w) fail(401,'Войдите в рабочее пространство');
      if(route==='/api/workspace' && req.method==='GET') return json(res,200,{workspace:w,projects:all('SELECT * FROM projects WHERE workspace=? ORDER BY created DESC,rowid DESC',w.id),events:all('SELECT text,created FROM events WHERE workspace=? ORDER BY id DESC LIMIT 12',w.id)});
      if(route==='/api/logout' && req.method==='POST') { const token=/(?:^|;\s*)brief_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1]; if(token) stmt('DELETE FROM sessions WHERE token=?',createHash('sha256').update(token).digest('hex')); res.setHeader('Set-Cookie','brief_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'); return json(res,200,{ok:true}); }
      if(route==='/api/projects' && req.method==='POST') { const p=fields(await body(req)); const key=addProject(w.id,p); event(w.id,`Новый проект: «${p.title}»`); return json(res,201,{id:key}); }
      const match=/^\/api\/projects\/([a-f0-9]{32})(?:\/(share))?$/.exec(route);
      if(match) {
        const p=one('SELECT * FROM projects WHERE id=? AND workspace=?',match[1],w.id); if(!p) fail(404,'Проект не найден');
        if(match[2]==='share' && req.method==='POST') {
          if(p.status==='won' || p.decision) fail(409,'Проект уже согласован');
          const share=p.share || randomBytes(24).toString('hex'); stmt("UPDATE projects SET share=?,status='review' WHERE id=?",share,p.id); event(w.id,`Предложение для ${p.client} готово к отправке`); return json(res,200,{share});
        }
        if(!match[2] && req.method==='PATCH') {
          const b=await body(req);
          if(p.decision) fail(409,'Согласованное предложение нельзя изменить. Создайте новый проект.');
          const f=fields({...p,...b}); const status=b.status || p.status;
          if(!statuses.includes(status)) fail(400,'Неизвестный статус');
          // Every edit revokes the old link so clients never approve silently changed terms.
          stmt('UPDATE projects SET title=?,client=?,email=?,description=?,amount=?,due=?,status=?,share=NULL WHERE id=?',f.title,f.client,f.email,f.description,f.amount,f.due,status,p.id);
          event(w.id,`Обновлён проект «${f.title}»`); return json(res,200,{ok:true});
        }
        if(!match[2] && req.method==='DELETE') { stmt('DELETE FROM projects WHERE id=?',p.id); event(w.id,`Удалён проект «${p.title}»`); return json(res,200,{ok:true}); }
      }
      fail(404,'Маршрут не найден');
    }
    if(!['GET','HEAD'].includes(req.method)) fail(405,'Метод не поддерживается');
    const files={'/':'index.html','/app.js':'app.js','/style.css':'style.css','/favicon.svg':'favicon.svg'};
    const filename=files[route] || (route.startsWith('/proposal/') ? 'index.html' : null);
    if(!filename) fail(404,'Страница не найдена');
    const types={html:'text/html; charset=utf-8',js:'text/javascript; charset=utf-8',css:'text/css; charset=utf-8',svg:'image/svg+xml'};
    res.writeHead(200,{'Content-Type':types[filename.split('.').pop()],'Cache-Control':'no-cache'}); res.end(req.method==='HEAD' ? undefined : readFileSync(path.join(root,'public',filename)));
  } catch(error) { if(!res.headersSent) json(res,Number.isInteger(error.code) ? error.code : 500,{error:Number.isInteger(error.code) ? error.message : 'Ошибка сервера'}); else res.end(); if(!Number.isInteger(error.code)) console.error(error); }
});
server.listen(Number(process.env.PORT || 3000),process.env.HOST || '127.0.0.1',()=>console.log(`Бриф запущен на порту ${server.address().port}`));
function shutdown() { server.close(()=>{db.close();process.exit(0);}); }
process.on('SIGTERM',shutdown); process.on('SIGINT',shutdown);
