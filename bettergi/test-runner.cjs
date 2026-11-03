const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, 'nod-krai-p2');
const source = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const plan = JSON.parse(fs.readFileSync(path.join(root, 'plan.json'), 'utf8'));

function mock(options = {}) {
  let time = Date.UTC(2026, 10, 3), current = {...(options.initialPosition||plan.targets.find(p=>p.number===3))}, heading = 0;
  let upCount = 0, ghostKeyCount = 0, storyTriggered = false, storyNullReads = 0;
  const unlocked = new Set([1, 2, 3, 5, 6]), held = new Set(), history = [], writes = new Map();
  if (options.range === '仅5→6') unlocked.delete(6);
  for(const n of options.initialLocked||[])unlocked.delete(n);
  const distance = (a,b) => Math.hypot(a.x-b.x,a.y-b.y);
  const getTarget = n => plan.targets.find(p=>p.number===n);
  const polar = (from,to) => (Math.atan2(-(to.y-from.y),-(to.x-from.x))*180/Math.PI+360)%360;
  function nativeReading(method, args) {
    history.push(['position-read',method,...args]);
    if (options.positionError || (method==='default' && options.defaultPositionError)) throw new Error('原生地图特征匹配失败');
    if (options.zeroPosition) return {x:0,y:0};
    if (options.nullPosition) return null;
    if(storyNullReads>0){storyNullReads--;return null;}
    const dx=method==='sift'&&options.siftOffset?100:0;
    return options.pascalCaseOnly?{X:current.x+dx,Y:current.y}:{x:current.x+dx,y:current.y};
  }
  const item = (text, y=400) => ({text,x:1000,y,width:150,height:30});
  function recognized(ro) {
    if (options.noPrompt) return [item('交谈')];
    if (options.range==='仅4号' && distance(current,plan.special.lift)<4) return [item('上行',400),item('下行',440)];
    const near = plan.targets.find(p=>p.number!==3 && !unlocked.has(p.number) && distance(current,p)<9);
    if (near && options.npcAbove) return [item('塔尔诺',365),item('传送锚点',400)];
    return near ? [item(near.number===9?'无光的深都':'传送锚点')] : [];
  }
  const host = {
    settings: {mode:options.mode===undefined?'执行开图路线':options.mode,range:options.range||'仅6→7',storyTimeoutSeconds:'30',teleportTarget:options.teleportTarget||'1'},
    getVersion:()=> '0.66.0',
    Date: class extends Date { constructor(...args){super(args.length?args[0]:time);} static now(){return time;} },
    sleep: async ms => {
      time += ms;
      if (held.has('W')) {
        if(options.cancelWhileMoving) throw new Error('cancelled');
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
    moveMouseBy:()=>{throw new Error('The script must delegate camera control to native orientation points');},
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
        return true;
      }
    },
    genshin:{
      width:options.gameWidth||1920,height:options.gameHeight||1080,screenDpiScale:options.dpi||1,
      returnMainUi:async()=>{history.push(['return-main-ui']);},
      clickMapPoint:async()=>{throw new Error('Generic map clicking must not be used; delegate to native TpTask');},
      tp:async(...args)=>{
        const [x,y]=args,n=plan.targets.find(p=>distance(p,{x,y})<.01).number;
        history.push(['tp',n,args.length]);
        if(options.nativeTpFailureFor===n || !unlocked.has(n)) throw new Error(options.nativeTpError||'原生传送无法确认目标');
        current=options.wrongArrivalFor===n?{...getTarget(1)}:{x,y};
      },
      getPositionFromMap:(...args)=>nativeReading('default',args),
      getPositionFromMapWithMatchingMethod:(...args)=>nativeReading('sift',args),
      getCameraOrientation:()=>options.invalidOrientation?null:heading
    },
    pathingScript:{
      run:async json=>{
        const native=JSON.parse(json);history.push(['native-run',native]);
        assert.equal(native.positions.length,1);assert.equal(native.positions[0].type,'orientation');
        heading=polar(current,native.positions[0])+(options.silentOrientationFailure?90:0);
      },
      runFile:async name=>{
        history.push(['path',name]);
        if(options.cancelAtPath && name.includes(options.cancelAtPath)) throw new Error('cancelled');
        if(options.cancelNativePath && name.includes('06-valley')) throw new Error('cancelled');
        if(options.story && name.includes('06-valley') && !storyTriggered){storyTriggered=true;storyNullReads=6;return;}
        if(!options.silentPathFailure){const native=JSON.parse(fs.readFileSync(path.join(root,name),'utf8'));current={...native.positions.at(-1)};}
      }
    }
  };
  return {host,history,held,writes,get upCount(){return upCount;},get ghostKeyCount(){return ghostKeyCount;}};
}
async function run(options){const m=mock(options);const task=vm.runInNewContext(source,m.host,{timeout:3000});return {m,task};}

(async()=>{
  let passed=0;
  async function test(name,fn){await fn();console.log('PASS '+name);passed++;}
  await test('unlock verification directly reuses native teleport and verifies arrival',async()=>{
    const {m,task}=await run();await task;
    const state=JSON.parse(m.writes.get('state.json'));
    assert.equal(state.completed['7'].proof,'native-teleport-and-stable-position');
    assert.ok(m.history.some(e=>e[0]==='path'&&e[1].includes('07-road')));
    assert.ok(!source.includes('genshin.clickMapPoint('));
  });
  await test('native navigation that logs failure and returns cannot advance',async()=>{
    const {m,task}=await run({silentPathFailure:true});await assert.rejects(task,/稳定/);
    const state=JSON.parse(m.writes.get('state.json'));
    assert.equal(state.completed['7'],undefined);assert.equal(state.status,'stopped');
    assert.equal(m.history.filter(e=>e[0]==='press'&&e[1]==='F').length,0);
  });
  await test('pressing F without successful native teleport does not prove unlock',async()=>{
    const {m,task}=await run({nativeTpFailureFor:7});await assert.rejects(task,/未确认到达/);
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
  await test('cancelling a short interaction approach releases the script-owned W key',async()=>{
    const {m,task}=await run({range:'仅4号',cancelWhileMoving:true});await assert.rejects(task,/cancelled/);
    assert.equal(m.held.size,0);assert.ok(m.history.some(e=>e[0]==='down'&&e[1]==='W'));
    assert.ok(m.history.some(e=>e[0]==='up'&&e[1]==='W'));
    assert.equal(JSON.parse(m.writes.get('state.json')).completed['4'],undefined);
  });
  await test('native valley cancellation clears the owned story timer',async()=>{
    const {m,task}=await run({range:'仅5→6',cancelNativePath:true});await assert.rejects(task,/cancelled/);
    assert.ok(m.history.some(e=>e[0]==='clear-timer'));
    assert.equal(JSON.parse(m.writes.get('state.json')).completed['6'],undefined);
  });
  await test('story interruption waits, returns to 5, retries once, then verifies 6',async()=>{
    const {m,task}=await run({range:'仅5→6',story:true});await task;
    assert.equal(m.history.filter(e=>e[0]==='tp'&&e[1]===5).length,2);
    assert.ok(JSON.parse(m.writes.get('state.json')).completed['6']);
    assert.equal(m.ghostKeyCount,1);assert.equal(m.held.size,0);
    for(const id of ['06-valley','06-spirit-approach'])assert.ok(m.history.some(e=>e[0]==='path'&&e[1].includes(id)));
    assert.ok(!m.history.some(e=>e[0]==='down'));
  });
  await test('roof route uses two distinct 上行 interactions before the waypoint',async()=>{
    const {m,task}=await run({range:'仅4号'});await task;
    assert.equal(m.upCount,2);assert.ok(JSON.parse(m.writes.get('state.json')).completed['4']);
    const orientation=m.history.find(e=>e[0]==='native-run')[1].positions[0];
    assert.equal(orientation.x,plan.targets.find(p=>p.number===4).x);
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
    const starts=['07-road','08-ledge','09-domain','10-uphill'].map(id=>{
      const index=m.history.findIndex(e=>e[0]==='path'&&e[1].includes(id));
      return m.history.slice(0,index).filter(e=>e[0]==='tp').at(-1)[1];
    });
    assert.deepEqual(starts,[6,7,7,6]);
    const state=JSON.parse(m.writes.get('state.json'));
    for(const n of [7,8,9,10])assert.ok(state.completed[String(n)]);
  });
  await test('2560×1440 with 150% DPI skips statue selection and uses normalized OCR',async()=>{
    const {m,task}=await run({gameWidth:2560,gameHeight:1440,dpi:1.5,markerFor:3});await task;
    assert.ok(!m.history.some(e=>e[0]==='map-click'&&e[1]===3));
    assert.deepEqual(m.history.find(e=>e[0]==='tp'),['tp',7,2]);
    const state=JSON.parse(m.writes.get('state.json'));
    assert.equal(state.completed['3'],undefined);
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
  await test('generic map projection and map-panel OCR are absent from verification',async()=>{
    const {m,task}=await run();await task;
    const state=JSON.parse(m.writes.get('state.json'));
    assert.equal(state.completed['7'].proof,'native-teleport-and-stable-position');
    const events=[...m.writes].filter(([n])=>n.endsWith('.jsonl.txt')).flatMap(([,v])=>v.trim().split('\n').map(JSON.parse));
    assert.ok(events.some(e=>e.type==='native-unlock-probe-unknown'&&e.detail.number===7));
    assert.ok(!events.some(e=>e.type==='map-check'));
  });
  await test('a broken statue selector is never invoked and does not block the chosen route',async()=>{
    const {m,task}=await run({nativeTpFailureFor:3,markerFor:3});await task;
    assert.equal(JSON.parse(m.writes.get('state.json')).completed['3'],undefined);
    assert.ok(JSON.parse(m.writes.get('state.json')).completed['7']);
    assert.ok(!m.history.some(e=>['tp','map-click'].includes(e[0])&&e[1]===3));
  });
  await test('native teleport to the wrong starting position cannot advance into navigation',async()=>{
    const {m,task}=await run({wrongArrivalFor:6});await assert.rejects(task,/稳定/);
    assert.equal(JSON.parse(m.writes.get('state.json')).completed['7'],undefined);
    assert.ok(!m.history.some(e=>e[0]==='path'));
  });
  await test('a silent native orientation failure prevents forward input at the lift exit',async()=>{
    const {m,task}=await run({range:'仅4号',silentOrientationFailure:true});await assert.rejects(task,/原生方位点/);
    assert.ok(m.history.some(e=>e[0]==='native-run'));
    assert.ok(!m.history.some(e=>e[0]==='down'));
    assert.equal(JSON.parse(m.writes.get('state.json')).completed['4'],undefined);
  });
  await test('new installations default to native self-check with no map or movement input',async()=>{
    const {m,task}=await run({mode:''});await task;
    const report=JSON.parse(m.writes.get('native-check.json'));
    assert.equal(report.samples.length,4);
    assert.deepEqual(report.summary,{defaultStable:true,siftStable:true,orientationReadable:true,matchersAgree:true});
    assert.ok(!m.history.some(e=>['tp','map-click','path','native-run','down','press'].includes(e[0])));
    assert.equal(m.writes.get('state.json'),undefined);
    for(const e of m.history.filter(e=>e[0]==='position-read'))assert.equal(e.at(-1),0);
  });
  await test('native self-check distinguishes default matcher failure from successful SIFT',async()=>{
    const {m,task}=await run({mode:'仅原生定位自检',defaultPositionError:true});await task;
    const report=JSON.parse(m.writes.get('native-check.json'));
    assert.equal(report.summary.defaultStable,false);assert.equal(report.summary.siftStable,true);
    assert.match(report.samples[0].default.reason,/原生地图特征/);
    assert.ok(m.history.some(e=>e[0]==='info'&&e[1].includes('地图追踪设置中选择 SIFT')));
  });
  await test('native API exceptions are recorded without claiming position recognition succeeded',async()=>{
    const {m,task}=await run({mode:'仅原生定位自检',positionError:true});await task;
    const report=JSON.parse(m.writes.get('native-check.json'));
    assert.equal(report.summary.defaultStable,false);assert.equal(report.summary.siftStable,false);
    assert.ok(!m.history.some(e=>['tp','map-click','path','native-run'].includes(e[0])));
  });
  await test('disagreeing native matchers are reported instead of proving an absolute position',async()=>{
    const {m,task}=await run({mode:'仅原生定位自检',siftOffset:true});await task;
    const report=JSON.parse(m.writes.get('native-check.json'));
    assert.equal(report.summary.defaultStable,true);assert.equal(report.summary.siftStable,true);
    assert.equal(report.summary.matchersAgree,false);
  });
  await test('zero coordinates and null orientation are invalid native readings',async()=>{
    const {m,task}=await run({mode:'仅原生定位自检',zeroPosition:true,invalidOrientation:true});await task;
    const report=JSON.parse(m.writes.get('native-check.json'));
    assert.equal(report.summary.defaultStable,false);assert.equal(report.summary.siftStable,false);
    assert.equal(report.summary.orientationReadable,false);
  });
  await test('native coordinate aliases support PascalCase-only hosts as well',async()=>{
    const {m,task}=await run({mode:'仅原生定位自检',pascalCaseOnly:true});await task;
    assert.equal(JSON.parse(m.writes.get('native-check.json')).summary.defaultStable,true);
  });
  await test('standalone native teleport test calls the public Tp wrapper with exact world coordinates',async()=>{
    const {m,task}=await run({mode:'仅原生传送测试'});await task;
    assert.deepEqual(m.history.filter(e=>e[0]==='tp'),[['tp',1,2]]);
    assert.ok(!m.history.some(e=>['ocr','position-read','path','native-run','down','press'].includes(e[0])));
    assert.equal(m.writes.get('state.json'),undefined);
    assert.equal(m.writes.get('native-check.json'),undefined);
  });
  await test('standalone native teleport test preserves the native failure instead of guessing an offset',async()=>{
    const {m,task}=await run({mode:'仅原生传送测试',nativeTpFailureFor:1,nativeTpError:'0 <= _rowRange.start && _rowRange.end <= m.rows'});
    await assert.rejects(task,/_rowRange/);
    assert.equal(m.history.filter(e=>e[0]==='tp').length,1);
    assert.ok(!m.history.some(e=>['ocr','position-read','path','native-run','down','press'].includes(e[0])));
    assert.equal(m.writes.get('state.json'),undefined);
  });
  await test('standalone native teleport test can request the user-confirmed statue directly',async()=>{
    const {m,task}=await run({mode:'仅原生传送测试',teleportTarget:'3'});await task;
    assert.deepEqual(m.history.filter(e=>e[0]==='tp'),[['tp',3,2]]);
  });
  await test('standing near the initial dock skips redundant native teleport without unlock proof',async()=>{
    const first=plan.targets.find(p=>p.number===1);
    const {m,task}=await run({range:'2—10',initialPosition:{x:first.x+4,y:first.y+14},initialLocked:[2],nativeTpFailureFor:1,cancelAtPath:'02-town'});
    await assert.rejects(task,/cancelled/);
    assert.ok(m.history.some(e=>e[0]==='path'&&e[1].includes('02-town')));
    assert.ok(!m.history.some(e=>e[0]==='tp'&&e[1]===1));
    const completed=JSON.parse(m.writes.get('state.json')).completed;
    assert.equal(completed['1'],undefined);assert.equal(completed['2'],undefined);
  });
  await test('a distant initial dock still requires actual native teleport before navigation',async()=>{
    const {m,task}=await run({range:'2—10',initialLocked:[2],cancelAtPath:'02-town'});
    await assert.rejects(task,/cancelled/);
    assert.ok(m.history.some(e=>e[0]==='tp'&&e[1]===1));
  });
  console.log(`${passed} runner/package checks passed; host mocks are not real-game validation.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
