const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, 'nod-krai-p2');
const source = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const plan = JSON.parse(fs.readFileSync(path.join(root, 'plan.json'), 'utf8'));

function mock(options = {}) {
  let time = Date.UTC(2026, 10, 3), mapTarget = null, current = {x:0,y:0}, lastLeg = '', heading = 0;
  let upCount = 0, ghostKeyCount = 0, storyTriggered = false, storyNullReads = 0;
  const unlocked = new Set([1, 2, 3, 5, 6]), held = new Set(), history = [], writes = new Map();
  if (options.range === '仅5→6') unlocked.delete(6);
  const distance = (a,b) => Math.hypot(a.x-b.x,a.y-b.y);
  const getTarget = n => plan.targets.find(p=>p.number===n);
  const polar = (from,to) => (Math.atan2(-(to.y-from.y),-(to.x-from.x))*180/Math.PI+360)%360;
  const pointIndices = new Map();
  function walkingPoint() {
    const leg = plan.legs.find(l=>l.id===lastLeg);
    if (!leg) return null;
    let i = pointIndices.get(lastLeg)||0;
    const tolerance=lastLeg==='06-spirit-approach'?2.5:6;
    while(i<leg.points.length-1 && distance(current,leg.points[i])<=tolerance)i++;
    pointIndices.set(lastLeg,i); return leg.points[i];
  }
  const item = (text, y=400) => ({text,x:1000,y,width:150,height:30});
  function recognized(ro) {
    if (mapTarget !== null) {
      if (mapTarget === 'marker') return [item('标记（点击更改标记名称）',70),item('确认',950)];
      if (ro.box[1] >= 700) return unlocked.has(mapTarget) ? [item(options.badFooter && mapTarget===7 ? '传送锚点' : '传送',950)] : [];
      const rows=[item(mapTarget===3 ? '新月神像' : mapTarget===9 ? '无光的深都' : '传送锚点',70)];
      if (!unlocked.has(mapTarget)) rows.push(item('未解锁',120));
      return rows;
    }
    if (options.noPrompt) return [item('交谈')];
    if (options.range==='仅4号' && distance(current,plan.special.lift)<4) return [item('上行',400),item('下行',440)];
    const near = plan.targets.find(p=>p.number!==3 && !unlocked.has(p.number) && distance(current,p)<9);
    if (near && options.npcAbove) return [item('塔尔诺',365),item('传送锚点',400)];
    return near ? [item(near.number===9?'无光的深都':'传送锚点')] : [];
  }
  const host = {
    settings: {range:options.range||'仅6→7',storyTimeoutSeconds:'30'},
    getVersion:()=> '0.66.0',
    Date: class extends Date { constructor(...args){super(args.length?args[0]:time);} static now(){return time;} },
    sleep: async ms => {
      time += ms;
      if (held.has('W')) {
        if(options.cancelWhileMoving) throw new Error('cancelled');
        if(options.story && !storyTriggered) { storyTriggered=true;storyNullReads=3; }
        if(options.range==='仅4号') heading=polar(current,getTarget(4));
        const step=ms/1000*6;
        current={x:current.x-Math.cos(heading*Math.PI/180)*step,y:current.y-Math.sin(heading*Math.PI/180)*step};
      }
    },
    keyDown:key=>{ held.add(key);history.push(['down',key]); },
    keyUp:key=>{ held.delete(key);history.push(['up',key]); },
    keyPress:key=>{
      history.push(['press',key]);
      if(key==='T')ghostKeyCount++;
      if(key==='F') {
        if(options.range==='仅4号'&&distance(current,plan.special.lift)<4) upCount++;
        else {
          const near=plan.targets.find(p=>p.number!==3&&!unlocked.has(p.number)&&distance(current,p)<10);
          if(near)unlocked.add(near.number);
        }
      }
    },
    moveMouseBy:(dx)=>{heading=(heading+dx/2+360)%360;},
    RecognitionObject:{ocr:(...box)=>({box})},
    captureGameRegion:()=>({width:options.captureWidth||1920,height:options.captureHeight||1080,srcMat:{},dispose(){},findMulti(ro){
      history.push(['ocr',...ro.box]);
      const list=recognized(ro);list.count=list.length;return list;
    }}),
    log:{info:message=>history.push(['info',message]),error:message=>history.push(['error',message])},
    RealtimeTimer:function(name){this.name=name;},
    dispatcher:{addTimer:timer=>history.push(['timer',timer.name]),clearAllTriggers:()=>history.push(['clear-timer'])},
    file:{
      readTextSync:name=>writes.get(name)||fs.readFileSync(path.join(root,name),'utf8'),
      isExists:name=>writes.has(name),createDirectory:()=>true,writeImageSync:()=>true,
      writeTextSync:(name,text,append=false)=>{
        writes.set(name,append?(writes.get(name)||'')+text:text);
        if(name==='state.json')lastLeg=JSON.parse(text).lastLeg;
        return true;
      }
    },
    genshin:{
      width:options.gameWidth||1920,height:options.gameHeight||1080,screenDpiScale:options.dpi||1,
      returnMainUi:async()=>{mapTarget=null;},
      clickMapPoint:async(x,y)=>{
        const n=plan.targets.find(p=>distance(p,{x,y})<.01).number;
        history.push(['map-click',n]);mapTarget=options.markerFor===n?'marker':n;
      },
      tp:async(...args)=>{
        const [x,y]=args,n=plan.targets.find(p=>distance(p,{x,y})<.01).number;
        history.push(['tp',n,args.length]);
        if(options.nativeTpFailureFor===n || !unlocked.has(n)) throw new Error('原生传送无法确认目标');
        current=options.wrongArrivalFor===n?{...getTarget(1)}:{x,y};pointIndices.clear();
      },
      getPositionFromMap:()=>{
        if(storyNullReads>0){storyNullReads--;return null;}
        return {X:current.x,Y:current.y};
      },
      getCameraOrientation:()=>{
        const p=walkingPoint();
        if(options.range==='仅4号')heading=polar(current,getTarget(4));
        else if(p)heading=polar(current,p);
        return heading;
      }
    },
    pathingScript:{runFile:async name=>{
      history.push(['path',name]);
      if(!options.silentPathFailure){const native=JSON.parse(fs.readFileSync(path.join(root,name),'utf8'));current={...native.positions.at(-1)};}
    }}
  };
  return {host,history,held,writes,get upCount(){return upCount;},get ghostKeyCount(){return ghostKeyCount;}};
}
async function run(options){const m=mock(options);const task=vm.runInNewContext(source,m.host,{timeout:3000});return {m,task};}

(async()=>{
  let passed=0;
  async function test(name,fn){await fn();console.log('PASS '+name);passed++;}
  await test('only a positively verified map teleport button records completion',async()=>{
    const {m,task}=await run();await task;
    const state=JSON.parse(m.writes.get('state.json'));
    assert.equal(state.completed['7'].proof,'selected-map-panel-exact-teleport-button');
    assert.ok(m.history.some(e=>e[0]==='path'&&e[1].includes('07-road')));
  });
  await test('native navigation that logs failure and returns cannot advance',async()=>{
    const {m,task}=await run({silentPathFailure:true});await assert.rejects(task,/稳定/);
    const state=JSON.parse(m.writes.get('state.json'));
    assert.equal(state.completed['7'],undefined);assert.equal(state.status,'stopped');
    assert.equal(m.history.filter(e=>e[0]==='press'&&e[1]==='F').length,0);
  });
  await test('传送锚点 text is not mistaken for an exact 传送 button',async()=>{
    const {m,task}=await run({badFooter:true,nativeTpFailureFor:7});await assert.rejects(task,/未确认可传送/);
    assert.equal(JSON.parse(m.writes.get('state.json')).completed['7'],undefined);
  });
  await test('missing target prompt never presses F on an unrelated NPC',async()=>{
    const {m,task}=await run({noPrompt:true});await assert.rejects(task,/正确交互提示/);
    assert.equal(m.history.filter(e=>e[0]==='press'&&e[1]==='F').length,0);
  });
  await test('an NPC proper name above the waypoint also blocks the F action',async()=>{
    const {m,task}=await run({npcAbove:true});await assert.rejects(task,/正确交互提示/);
    assert.equal(m.history.filter(e=>e[0]==='press'&&e[1]==='F').length,0);
  });
  await test('cancelled foreground movement releases W and clears the owned story timer',async()=>{
    const {m,task}=await run({range:'仅5→6',cancelWhileMoving:true});await assert.rejects(task,/cancelled/);
    assert.equal(m.held.size,0);assert.ok(m.history.some(e=>e[0]==='down'&&e[1]==='W'));
    assert.ok(m.history.some(e=>e[0]==='up'&&e[1]==='W'));assert.ok(m.history.some(e=>e[0]==='clear-timer'));
    assert.equal(JSON.parse(m.writes.get('state.json')).completed['6'],undefined);
  });
  await test('story interruption waits, returns to 5, retries once, then verifies 6',async()=>{
    const {m,task}=await run({range:'仅5→6',story:true});await task;
    assert.equal(m.history.filter(e=>e[0]==='tp'&&e[1]===5).length,2);
    assert.ok(JSON.parse(m.writes.get('state.json')).completed['6']);
    assert.equal(m.ghostKeyCount,1);assert.equal(m.held.size,0);
  });
  await test('roof route uses two distinct 上行 interactions before the waypoint',async()=>{
    const {m,task}=await run({range:'仅4号'});await task;
    assert.equal(m.upCount,2);assert.ok(JSON.parse(m.writes.get('state.json')).completed['4']);
  });
  await test('source origin and real teleport start for 9 are preserved',async()=>{
    assert.equal(plan.source.frameCount,15612);assert.equal(plan.special.domainStartTarget,7);
    assert.ok(plan.legs.find(l=>l.id==='02-town').points.some(p=>p.origin==='guide-map'));
    assert.ok(plan.legs.find(l=>l.id==='08-flight').points.some(p=>p.origin==='continuous-flight'));
    for(const leg of plan.legs){
      const native=JSON.parse(fs.readFileSync(path.join(root,'routes',leg.id+'.json'),'utf8'));
      assert.equal(native.positions.length,leg.points.length);
      assert.equal(native.positions.at(-1).type,'target');
      assert.ok(native.positions.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)));
    }
  });
  await test('7–10 execution returns to 7 for the domain and 6 for the final descent',async()=>{
    const {m,task}=await run({range:'6—10'});await task;
    const teleports=m.history.filter(e=>e[0]==='tp').map(e=>e[1]);
    assert.deepEqual(teleports,[3,6,7,7,6]);
    const state=JSON.parse(m.writes.get('state.json'));
    for(const n of [7,8,9,10])assert.ok(state.completed[String(n)]);
  });
  await test('2560×1440 with 150% DPI uses native statue teleport and normalized OCR',async()=>{
    const {m,task}=await run({gameWidth:2560,gameHeight:1440,dpi:1.5,markerFor:3});await task;
    assert.ok(!m.history.some(e=>e[0]==='map-click'&&e[1]===3));
    assert.deepEqual(m.history.find(e=>e[0]==='tp'),['tp',3,2]);
    const state=JSON.parse(m.writes.get('state.json'));
    assert.equal(state.completed['3'].proof,'native-teleport-and-stable-position');
    for(const [type,x,y,w,h] of m.history.filter(e=>e[0]==='ocr'))assert.ok(x>=0&&y>=0&&x+w<=1920&&y+h<=1080);
    const events=[...m.writes].filter(([n])=>n.endsWith('.jsonl.txt')).flatMap(([,v])=>v.trim().split('\n').map(JSON.parse));
    const environment=events.find(e=>e.type==='environment').detail;
    assert.deepEqual([environment.gameWidth,environment.gameHeight,environment.screenDpiScale],[2560,1440,1.5]);
  });
  await test('non-16:9 client is rejected before any map input, even if a capture is 16:9',async()=>{
    const {m,task}=await run({gameWidth:2560,gameHeight:1600});await assert.rejects(task,/客户区为2560×1600|客户区为 2560×1600/);
    assert.ok(!m.history.some(e=>['tp','map-click','down','press','path'].includes(e[0])));
  });
  await test('a cropped capture cannot override a valid actual game aspect ratio',async()=>{
    const {m,task}=await run({gameWidth:2560,gameHeight:1440,captureWidth:1912,captureHeight:1080});await task;
    assert.ok(JSON.parse(m.writes.get('state.json')).completed['7']);
  });
  await test('a custom marker editor is unknown, then native teleport can prove unlock',async()=>{
    const {m,task}=await run({markerFor:7});await task;
    const state=JSON.parse(m.writes.get('state.json'));
    assert.equal(state.completed['7'].proof,'native-teleport-and-stable-position');
    const events=[...m.writes].filter(([n])=>n.endsWith('.jsonl.txt')).flatMap(([,v])=>v.trim().split('\n').map(JSON.parse));
    assert.ok(events.some(e=>e.type==='map-check'&&e.detail.number===7&&e.detail.result==='unknown'));
    assert.ok(!events.some(e=>e.type==='map-check'&&e.detail.number===7&&e.detail.result==='locked'));
  });
  await test('a statue recognition failure is not reported as an unlit statue',async()=>{
    const {m,task}=await run({nativeTpFailureFor:3});await assert.rejects(task,/不能据此判定未解锁/);
    assert.equal(JSON.parse(m.writes.get('state.json')).completed['3'],undefined);
    assert.ok(!m.history.some(e=>e[0]==='path'));
  });
  await test('native teleport to the wrong position cannot prove the statue is unlocked',async()=>{
    const {m,task}=await run({wrongArrivalFor:3});await assert.rejects(task,/不能据此判定未解锁/);
    assert.equal(JSON.parse(m.writes.get('state.json')).completed['3'],undefined);
  });
  console.log(`${passed} runner/package checks passed; host mocks are not real-game validation.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
