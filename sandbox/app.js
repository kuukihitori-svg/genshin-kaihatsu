/* UI adapter: all gameplay decisions remain in World. Imported text is never HTML/code. */
'use strict';
const $ = id => document.getElementById(id);
let world, scene;
const labels = {locked:'锁定',available:'可开启',opened:'已开启'};
function report(el, message, ok) { el.textContent = message; el.className = ok ? 'success' : 'error'; }
function load(data) { const next = new TaskSandbox.World(data); scene = next.snapshot().scene; world = next; $('json').value = JSON.stringify(scene,null,2); render(); report($('feedback'),'世界已载入',true); }
function act(action) { const result = world.dispatch(action); report($('feedback'),result.code+'：'+result.message,result.ok); render(); return result; }
function svg(tag, attrs, text) { const el=document.createElementNS('http://www.w3.org/2000/svg',tag); for(const [k,v] of Object.entries(attrs)) el.setAttribute(k,v); if(text) el.textContent=text; return el; }
function render() {
 const s=world.snapshot(), b=scene.bounds, map=$('map');
 map.replaceChildren(); map.setAttribute('viewBox',`${b.minX} ${b.minY} ${b.maxX-b.minX} ${b.maxY-b.minY}`);
 const unit=Math.min(b.maxX-b.minX,b.maxY-b.minY)/100;
 function circle(x,y,r,fill,stroke,dash){map.append(svg('circle',{cx:x,cy:y,r,fill,stroke,'pointer-events':'none','stroke-width':.35*unit,...(dash?{'stroke-dasharray':unit}: {})}));}
 function entity(x,y,color,name,callback,square=false){const g=svg('g',{class:'entity',role:'button',tabindex:0,'aria-label':name});g.append(svg(square?'rect':'circle',square?{x:x-2*unit,y:y-2*unit,width:4*unit,height:4*unit,fill:color,transform:`rotate(45 ${x} ${y})`}:{cx:x,cy:y,r:2*unit,fill:color}));const t=svg('text',{x,y:y+(callback?-3.5:6)*unit,'text-anchor':'middle',style:`font-size:${2.7*unit}px`},name);g.append(t);if(!callback)g.setAttribute('pointer-events','none');if(callback){g.onclick=e=>{e.stopPropagation();callback();};g.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();callback();}};}map.append(g);}
 scene.areas.forEach(a=>circle(a.x,a.y,a.radius,s.battle.active?'#793a3033':'#287b6333','#64b89d',true));
 circle(s.player.x,s.player.y,scene.combat.attackRange,'none','#37638a',true);
 circle(s.chest.x,s.chest.y,scene.chest.interactionRange,'none','#8c7544',true);
 s.enemies.forEach(e=>entity(e.x,e.y,e.hp?'#ef827d':'#677581',`${e.name} ${e.hp}/${e.maxHp}`,()=>act({type:'attack',targetId:e.id})));
 entity(s.chest.x,s.chest.y,{locked:'#8492a0',available:'#f4c369',opened:'#68ccb0'}[s.chest.state],labels[s.chest.state],()=>act({type:'interact'}),true);
 entity(s.player.x,s.player.y,s.player.hp?'#75bcff':'#9b748d','角色');
 $('title').textContent=scene.quest.title;
 $('stats').textContent=`生命 ${s.player.hp}/${s.player.maxHp} · 代币 ${s.inventory.tokens} · ${s.player.hp===0?'角色倒下':s.battle.cleared?'战斗结束':s.battle.active?'战斗进行中':'战斗未激活'} · ${s.quest.complete?'任务完成（模拟通过）':'任务进行中'}`;
 $('quest').replaceChildren(...s.quest.steps.map(step=>{const li=document.createElement('li');li.className=step.status;li.textContent=({completed:'✓ ',active:'→ ',pending:'○ '})[step.status]+step.title;return li;}));
 $('enemies').textContent=s.enemies.map(e=>`${e.name}：${e.hp}/${e.maxHp}`).join(' ｜ ');
 $('chest').textContent=`宝箱：${labels[s.chest.state]}；距离 ${Math.hypot(s.player.x-s.chest.x,s.player.y-s.chest.y).toFixed(1)} / 交互范围 ${scene.chest.interactionRange}`;
 $('log').replaceChildren(...s.events.slice(-150).map(e=>{const li=document.createElement('li');li.textContent=`[${e.tick}] ${e.type} · ${e.message}`;if(e.type==='rejected')li.className='error';return li;}));$('log').scrollTop=$('log').scrollHeight;
 $('source').textContent=JSON.stringify(scene.provenance,null,2)+'\n'+JSON.stringify(scene.rules,null,2);
 $('step').disabled=JSON.stringify(scene)!==JSON.stringify(DEMO_SCENE)||s.quest.complete||s.player.hp===0;
}
$('map').onclick=e=>{const pt=new DOMPoint(e.clientX,e.clientY).matrixTransform($('map').getScreenCTM().inverse());act({type:'move',x:pt.x,y:pt.y});};
$('move').onsubmit=e=>{e.preventDefault();act({type:'move',x:Number($('x').value),y:Number($('y').value)});};
$('attack').onclick=()=>act({type:'attack'});$('interact').onclick=()=>act({type:'interact'});$('reset').onclick=()=>act({type:'reset'});$('demo').onclick=()=>load(DEMO_SCENE);
$('step').onclick=()=>{const s=world.snapshot(), c=scene.combat, a=scene.areas.find(a=>a.id===c.battleAreaId), enemy=s.enemies.find(e=>e.groupId===c.groupId&&e.hp>0);if(enemy){if(Math.hypot(s.player.x-a.x,s.player.y-a.y)>a.radius||Math.hypot(s.player.x-enemy.x,s.player.y-enemy.y)>c.attackRange)act({type:'move',x:enemy.x,y:enemy.y});else act({type:'attack',targetId:enemy.id});}else if(Math.hypot(s.player.x-s.chest.x,s.player.y-s.chest.y)>scene.chest.interactionRange)act({type:'move',x:s.chest.x,y:s.chest.y});else act({type:'interact'});};
function importText(text){try{if(new TextEncoder().encode(text).length>262144)throw Error('超过 256 KiB 限制');load(JSON.parse(text));report($('import-result'),'校验通过，已导入新的模拟世界。',true);}catch(e){report($('import-result'),'导入失败：'+e.message,false);}}
$('import').onclick=()=>importText($('json').value);
$('file').onchange=async e=>{const f=e.target.files[0];if(!f)return;if(f.size>262144){report($('import-result'),'导入失败：超过 256 KiB 限制',false);return;}try{importText(await f.text());}catch(err){report($('import-result'),'读取失败：'+err.message,false);}};
load(DEMO_SCENE);
