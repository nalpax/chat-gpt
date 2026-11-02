import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
const data=mkdtempSync(path.join(os.tmpdir(),'brief-test-'));
let child,base,persistCookie;
async function start(realAccounts='1'){
 child=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'0',DATA_DIR:data,ENABLE_REAL_ACCOUNTS:realAccounts},stdio:['ignore','pipe','pipe']});
 const output=await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('Server exited');})]);
 base='http://127.0.0.1:'+String(output[0]).match(/порту (\d+)/)[1];
}
before(()=>start());
after(async()=>{if(child.exitCode===null){const done=once(child,'exit');child.kill();await done;}rmSync(data,{recursive:true,force:true});});
async function request(route,{method='GET',body,cookie,origin}={}){const r=await fetch(base+route,{method,headers:{...(body!==undefined?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{}),...(origin?{origin}:{})},body:body!==undefined?JSON.stringify(body):undefined});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0],headers:r.headers};}
const project={title:'Сайт компании',client:'Тестовый клиент',amount:125000,description:'Дизайн и разработка',due:'2027-01-20'};
test('health, auth and workspace isolation',async()=>{
 assert.equal((await request('/api/health')).data.ok,true);
 assert.equal((await request('/api/workspace')).status,401);
 const a=await request('/api/demo',{method:'POST',body:{}}), b=await request('/api/demo',{method:'POST',body:{}});
 assert.equal(a.status,201);assert.notEqual(a.cookie,b.cookie);
 const wa=await request('/api/workspace',{cookie:a.cookie});assert.equal(wa.data.projects.length,6);
 const wb=await request('/api/workspace',{cookie:b.cookie});assert.notEqual(wa.data.projects[0].id,wb.data.projects[0].id);
 const blocked=await request('/api/projects/'+wa.data.projects[0].id,{method:'DELETE',body:{},cookie:b.cookie});assert.equal(blocked.status,404);
 assert.equal((await request('/api/projects',{method:'POST',body:project,cookie:a.cookie,origin:'https://evil.example'})).status,403);
});
test('proposal lifecycle, explicit approval and revoked links',async()=>{
 const {cookie}=await request('/api/demo',{method:'POST',body:{}});
 const created=await request('/api/projects',{method:'POST',body:project,cookie});assert.equal(created.status,201);
 const route='/api/projects/'+created.data.id;
 const first=await request(route+'/share',{method:'POST',body:{},cookie});assert.equal(first.status,200);
 let shared=await request('/api/public/'+first.data.share);assert.equal(shared.data.amount,125000);assert.equal(shared.data.workspace,undefined);assert.equal(shared.data.email,undefined);
 assert.equal((await request(route,{method:'PATCH',body:{amount:140000},cookie})).status,200);
 assert.equal((await request('/api/public/'+first.data.share)).status,404);
 const second=await request(route+'/share',{method:'POST',body:{},cookie});assert.notEqual(second.data.share,first.data.share);
 assert.equal((await request('/api/public/'+second.data.share+'/approve',{method:'POST',body:{}})).status,200);
 assert.equal((await request('/api/public/'+second.data.share+'/approve',{method:'POST',body:{}})).status,409);
 assert.equal((await request(route,{method:'PATCH',body:{amount:1},cookie})).status,409);
 const ws=(await request('/api/workspace',{cookie})).data;const p=ws.projects.find(p=>p.id===created.data.id);assert.equal(p.status,'won');assert.ok(p.decision);assert.equal(p.amount,140000);
 assert.equal((await request(route,{method:'DELETE',body:{},cookie})).status,200);
 assert.equal((await request('/api/public/'+second.data.share)).status,404);
});
test('registration, login, validation and logout',async()=>{
 const account={email:'test@example.org',password:'strong password 123',name:'Test Studio'};
 const signup=await request('/api/register',{method:'POST',body:account});assert.equal(signup.status,201);persistCookie=signup.cookie;
 assert.equal((await request('/api/register',{method:'POST',body:account})).status,409);
 assert.equal((await request('/api/login',{method:'POST',body:{...account,password:'incorrect password'}})).status,401);
 const login=await request('/api/login',{method:'POST',body:account});assert.equal(login.status,200);
 assert.equal((await request('/api/workspace',{cookie:login.cookie})).data.projects.length,0);
 for(const bad of [{amount:-1},{amount:1.5},{due:'2027-02-30'},{email:'wrong'},{title:''},{amount:1e15}])assert.equal((await request('/api/projects',{method:'POST',body:{...project,...bad},cookie:login.cookie})).status,400);
 assert.equal((await request('/api/logout',{method:'POST',body:{},cookie:login.cookie})).status,200);
 assert.equal((await request('/api/workspace',{cookie:login.cookie})).status,401);
});
test('unknown routes, CSP and static files',async()=>{
 const r=await fetch(base);assert.equal(r.status,200);assert.match(r.headers.get('content-security-policy'),/script-src 'self'/);assert.match(await r.text(),/lang="ru"/);
 assert.equal((await request('/not-found')).status,404);
 assert.equal((await request('/api/public/invalid')).status,404);
});
test('data survives restart and real accounts are disabled by default',async()=>{
 const done=once(child,'exit');child.kill();await done;await start('');
 assert.equal((await request('/api/config')).data.realAccountsEnabled,false);
 assert.equal((await request('/api/register',{method:'POST',body:{}})).status,403);
 assert.equal((await request('/api/login',{method:'POST',body:{}})).status,403);
 const restored=await request('/api/workspace',{cookie:persistCookie});assert.equal(restored.status,200);assert.equal(restored.data.workspace.name,'Test Studio');
});
