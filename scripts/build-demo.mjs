import {readFileSync,writeFileSync} from 'node:fs';
const root=new URL('../',import.meta.url);
const read=p=>readFileSync(new URL(p,root),'utf8');
const adapter=String.raw`
const DEMO_KEY='brief-browser-demo-v1';
let localData;
try { localData=JSON.parse(localStorage.getItem(DEMO_KEY)||'null'); } catch { localData=null; }
const persist=()=>{try{localStorage.setItem(DEMO_KEY,JSON.stringify(localData));}catch{throw new Error('Разрешите локальное хранение в браузере, чтобы сохранять демо.');}};
const demoID=()=>Array.from(crypto.getRandomValues(new Uint8Array(16)),v=>v.toString(16).padStart(2,'0')).join('');
const stamp=()=>new Date().toISOString();
const localError=(status,message)=>{throw Object.assign(new Error(message),{status});};
const logEvent=text=>localData.events.unshift({text,created:stamp()});
async function api(url,method='GET',data){
 if(url==='/api/config')return {realAccountsEnabled:false};
 if(url==='/api/demo'&&method==='POST'){
  const rows=[['Сайт для нового бренда','NØRD',240000,'new',8,'Интернет-магазин предметов интерьера. Каталог до 50 товаров и адаптивный дизайн.'],['Айдентика кофейни','SLOW Coffee',85000,'new',12,'Логотип, цветовая палитра и упаковка.'],['Редизайн личного кабинета','Orbit',180000,'progress',5,'Пользовательские сценарии и дизайн 12 экранов.'],['Лендинг летней коллекции','Linen',120000,'review',3,'Арт-дирекшн и адаптивный лендинг. Два раунда правок.'],['Дизайн-система','Capsule',320000,'won',20,'Компоненты, токены и документация.'],['Сайт архитектурного бюро','ARCH / 01',210000,'progress',15,'Портфолио, страница команды и форма обращения.']];
  localData={workspace:{id:demoID(),name:'Forma Studio',demo:1},events:[{text:'Открыто браузерное демо',created:stamp()}],projects:rows.map(([title,client,amount,status,days,description])=>({id:demoID(),title,client,amount,status,description,email:'',due:new Date(Date.now()+days*86400000).toISOString().slice(0,10),created:stamp(),share:null,decision:null}))};persist();return {ok:true};
 }
 if(url==='/api/logout'){localData=null;persist();return {ok:true};}
 if(!localData)localError(401,'Сначала откройте демо на главной странице в этом браузере.');
 if(url==='/api/workspace')return structuredClone(localData);
 if(url==='/api/projects'&&method==='POST'){
  const p={...data,id:demoID(),status:'new',share:null,decision:null,created:stamp()};localData.projects.unshift(p);logEvent('Новый проект: «'+p.title+'»');persist();return {id:p.id};
 }
 const pub=/^\/api\/public\/([a-f0-9]+)(\/approve)?$/.exec(url);
 if(pub){const p=localData.projects.find(x=>x.share===pub[1]);if(!p)localError(404,'Демо-ссылка не найдена. Она доступна только в том же браузере, где создана.');if(method==='GET')return {...p,studio:localData.workspace.name};if(method==='POST'&&pub[2]){if(p.decision||p.status!=='review')localError(409,'Предложение уже согласовано или отозвано');p.decision=stamp();p.status='won';logEvent(p.client+' согласовал(а) «'+p.title+'»');persist();return {ok:true};}}
 const m=/^\/api\/projects\/([a-f0-9]+)(\/share)?$/.exec(url);
 if(m){const p=localData.projects.find(x=>x.id===m[1]);if(!p)localError(404,'Проект не найден');if(method==='DELETE'){localData.projects=localData.projects.filter(x=>x!==p);logEvent('Проект удалён');persist();return {ok:true};}if(p.decision)localError(409,'Условия уже приняты');if(method==='PATCH'){Object.assign(p,data,{share:null});logEvent('Обновлён проект «'+p.title+'»');persist();return {ok:true};}if(method==='POST'&&m[2]){if(p.status==='won')localError(409,'Проект уже согласован');p.share=p.share||demoID();p.status='review';logEvent('Демо-предложение готово к просмотру');persist();return {share:p.share};}}
 localError(404,'Эта функция недоступна в браузерном демо');
}
`;
let js=read('public/app.js');
const start=js.indexOf('async function api('),end=js.indexOf('\nfunction toast',start);
js=js.slice(0,start)+adapter+js.slice(end);
js=js.replaceAll("location.pathname.startsWith('/proposal/')","location.hash.startsWith('#proposal/')")
 .replaceAll("location.pathname.split('/')[2]","location.hash.split('/')[1]")
 .replaceAll("location.origin+'/proposal/'","location.href.split('#')[0]+'#proposal/'")
 .replaceAll('Все изменения сохранены','Демо · сохранено в этом браузере')
 .replaceAll('О реальном запуске','О демо')
 .replaceAll('Регистрация и вход отключены. Для реальных данных нужно настроить размещение в России, сведения об операторе и документы обработки персональных данных.','Это браузерное демо без сервера. Данные сохраняются только в этом браузере. Регистрации и отправки сообщений здесь нет.')
 .replaceAll('Пока попробуйте отдельное демо. Используйте только вымышленные данные — регион этой облачной среды не подтверждён.','Используйте вымышленные данные. Клиентские демо-ссылки работают только в том же браузере. Для реальной работы потребуется отдельно размещённая серверная версия.')
 .replaceAll('Это ваше личное демо.','Браузерное демо.')
 .replaceAll('Используйте только вымышленные данные. Не вводите персональные данные реальных людей.','Данные — только в этом браузере. Ссылки не работают у других людей. Используйте вымышленные данные.')
 .replaceAll('Ссылка готова — отправьте её клиенту','Демо-ссылка — работает только в этом браузере')
 .replaceAll('Ссылка открывает клиенту название, задачу, бюджет и срок.','Демо-ссылка доступна только в этом браузере, не отправляйте её настоящим клиентам.')
 .replaceAll('Без карты · Без платных API · Ваши данные на вашем сервере','Браузерное демо · Без регистрации · Только вымышленные данные')
 .replaceAll('Отправьте предложение','Посмотрите предложение')
 .replaceAll('Одна аккуратная ссылка вместо потерявшегося файла в чате.','В серверной версии — одна ссылка вместо потерявшегося файла. Здесь можно проверить этот сценарий в своём браузере.')
 .replaceAll('Клиент принимает предложение без аккаунта. Статус обновляется сразу.','Примерьте роль клиента в своём браузере и посмотрите, как обновляется статус.')
 .replaceAll('Откройте проект и создайте ссылку. Клиент увидит условия и сможет принять предложение без регистрации.','Откройте проект и создайте демо-ссылку. Посмотрите и примите предложение в этом же браузере.')
 .replaceAll('href="/"','href="#"');
const svg='data:image/svg+xml;base64,'+Buffer.from(read('public/favicon.svg')).toString('base64');
js=js.replaceAll('/favicon.svg',svg);
js="window.addEventListener('hashchange',()=>location.reload());\n"+js;
const html=`<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><title>Бриф — браузерное демо</title><link rel="icon" href="${svg}"><style>${read('public/style.css')}</style></head><body><div id="app"><div class="loading">Открываем демо…</div></div><div id="toast" role="status" aria-live="polite"></div><div id="modal-root"></div><script type="module">${js.replaceAll('</script','<\\/script')}</script></body></html>`;
writeFileSync(new URL('docs/index.html',root),html);
console.log('Built standalone demo: docs/index.html');
