const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname,'nod-krai-all');
const source = fs.readFileSync(path.join(root,'main.js'),'utf8');
const original = JSON.parse(fs.readFileSync(path.join(root,'plan.json'),'utf8'));

function fixture(options={}) {
  const plan=structuredClone(original), history=[], writes=new Map();
  const module=plan.modules.find(m=>m.id===(options.module||'6.0-13'));
  const target=plan.catalog.targets.find(t=>t.id===module.target);
  const start=plan.catalog.targets.find(t=>t.id===module.from);
  const route=plan.routes.find(r=>r.id===module.steps[0].route);
  if(options.unknownStep)module.steps.push({kind:'unsupported-mechanism'});
  if(options.invalidRouteMap)route.mapName='MoonCanon';
  if(options.moonContract){
    start.mapName=target.mapName=route.mapName='MoonCanon';
    start.id='MoonCanon:fixture-start';target.id='MoonCanon:fixture-target';
    module.from=start.id;module.target=target.id;
  }
  let current={...start.arrival}, time=0, unlocked=!!options.alreadyUnlocked;
  const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
  const host={
    settings:{mode:options.mode||'运行一个已恢复路段',region:options.region||target.region,module:module.id},
    getVersion:()=>options.version||'0.66.0',
    Date:class extends Date {constructor(){super(time);}static now(){return time;}},
    sleep:async ms=>{time+=ms;},
    log:{info:s=>history.push(['info',s])},
    keyPress:key=>{history.push(['press',key]);if(key==='F'&&!options.activationFails)unlocked=true;},
    RecognitionObject:{ocr:(...args)=>args},
    captureGameRegion:()=>({width:1920,height:1080,srcMat:{},dispose(){},findMulti(){
      history.push(['ocr']);
      const a=!options.noPrompt&&dist(current,target.position)<12?[{text:'传送锚点',x:1050,y:400}]:[];
      if(options.npcAbove&&a.length)a.unshift({text:'塔尔诺',x:1050,y:360});
      a.count=a.length;return a;
    }}),
    file:{readTextSync:name=>name==='plan.json'?JSON.stringify(plan):writes.get(name),
      isExists:name=>writes.has(name)||fs.existsSync(path.join(root,name)),createDirectory:()=>true,writeImageSync:()=>true,
      writeTextSync:(name,data,append=false)=>{writes.set(name,append?(writes.get(name)||'')+data:data);return true;}},
    genshin:{width:options.width||2560,height:options.height||1440,
      getPositionFromMap:(map,cache)=>{history.push(['position',map,cache]);if(options.positionFails)throw new Error('匹配失败');return {...current};},
      returnMainUi:async()=>history.push(['main']),
      tp:async(x,y,map,force)=>{
        history.push(['tp',x,y,map,force]);
        const t=dist({x,y},target.position)<.01?target:start;
        if(t===target&&(!unlocked||options.verificationFails))throw new Error('原生传送无法确认');
        if(options.wrongStart&&t===start)current={x:0,y:1};else current={...t.arrival};
      }},
    pathingScript:{
      runFile:async name=>{
        history.push(['path',name]);if(options.cancel)throw new Error('cancelled');
        if(!options.silentPathFailure){const native=JSON.parse(fs.readFileSync(path.join(root,name),'utf8'));current={...native.positions.at(-1)};}
      },
      run:async data=>{history.push(['short-approach']);if(!options.silentPathFailure)current={...JSON.parse(data).positions.at(-1)};}
    }
  };
  return {host,history,writes,target,module,run:()=>vm.runInNewContext(source,host,{timeout:3000})};
}

(async()=>{
  let passed=0;
  async function test(name,fn){await fn();passed++;console.log('PASS '+name);}
  await test('coverage mode has no game reads or inputs and never claims full completion',async()=>{
    const f=fixture({mode:'查看分区覆盖'});await f.run();const r=JSON.parse(f.writes.get('coverage-report.json'));
    assert.equal(r.fullCampaignReady,false);assert.equal(r.inventory.total,145);assert.equal(r.executableModules,21);
    assert.ok(!f.history.some(e=>['tp','path','position','ocr','press','main'].includes(e[0])));assert.equal(f.writes.has('state.json'),false);
  });
  await test('normal route requires native source teleport, actual F and fresh destination teleport',async()=>{
    const f=fixture();await f.run();const s=JSON.parse(f.writes.get('state.json'));
    assert.ok(s.completed[f.target.id]);assert.ok(f.history.some(e=>e[0]==='press'&&e[1]==='F'));
    assert.ok(f.history.filter(e=>e[0]==='tp').every(e=>e[3]==='Teyvat'&&e[4]===false));
    assert.equal(s.status,'selected-module-verified');assert.equal(Object.keys(s.completed).length,1);
  });
  await test('native silent path failure cannot advance or press F',async()=>{
    const f=fixture({silentPathFailure:true});await assert.rejects(f.run(),/稳定位置/);
    assert.ok(!f.history.some(e=>e[0]==='press'));assert.deepEqual(JSON.parse(f.writes.get('state.json')).completed,{});
  });
  await test('an activation without native teleport verification is not completion',async()=>{
    const f=fixture({verificationFails:true});await assert.rejects(f.run(),/核验失败/);
    assert.deepEqual(JSON.parse(f.writes.get('state.json')).completed,{});
  });
  await test('unrelated NPC above the target is never activated',async()=>{
    const f=fixture({npcAbove:true});await assert.rejects(f.run(),/未找到目标交互/);
    assert.ok(!f.history.some(e=>e[0]==='press'));
  });
  await test('blocked water route stops before any game access',async()=>{
    const f=fixture({module:'6.0-36'});await assert.rejects(f.run(),/芙宁娜/);
    assert.equal(f.history.length,0);assert.equal(f.writes.size,0);
  });
  await test('unknown mechanism is caught before map input',async()=>{
    const f=fixture({unknownStep:true});await assert.rejects(f.run(),/模块缺少/);assert.equal(f.history.length,0);
  });
  await test('wrong route map is caught before map input',async()=>{
    const f=fixture({invalidRouteMap:true});await assert.rejects(f.run(),/模块缺少/);assert.equal(f.history.length,0);
  });
  await test('non 16:9 game client stops before native teleport',async()=>{
    const f=fixture({height:1600});await assert.rejects(f.run(),/16:9/);assert.equal(f.history.length,0);
  });
  await test('wrong source arrival never starts a path',async()=>{
    const f=fixture({wrongStart:true});await assert.rejects(f.run(),/稳定位置/);assert.ok(!f.history.some(e=>e[0]==='path'));
  });
  await test('native cancellation is preserved without completion',async()=>{
    const f=fixture({cancel:true});await assert.rejects(f.run(),/cancelled/);assert.deepEqual(JSON.parse(f.writes.get('state.json')).completed,{});
  });
  await test('already open target is reverified without running its approach route',async()=>{
    const f=fixture({alreadyUnlocked:true});await f.run();assert.ok(!f.history.some(e=>['path','press'].includes(e[0])));
    assert.ok(JSON.parse(f.writes.get('state.json')).completed[f.target.id]);
  });
  await test('synthetic MoonCanon API contract preserves independent map names',async()=>{
    const f=fixture({moonContract:true,alreadyUnlocked:true});await f.run();
    assert.ok(f.history.filter(e=>e[0]==='tp').every(e=>e[3]==='MoonCanon'));
    assert.ok(f.history.filter(e=>e[0]==='position').every(e=>e[1]==='MoonCanon'&&e[2]===0));
  });
  console.log(`${passed} campaign host checks passed; no actual MoonCanon route or game collision was validated.`);
})().catch(e=>{console.error(e);process.exitCode=1;});
