'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, 'natlan');
const source = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const originalPlan = JSON.parse(fs.readFileSync(path.join(root, 'plan.json'), 'utf8'));
const originalCatalogue = JSON.parse(fs.readFileSync(path.join(root, 'catalogue.json'), 'utf8'));
const clone = value => JSON.parse(JSON.stringify(value));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function mock(options = {}) {
  const plan = clone(originalPlan), catalogue = clone(originalCatalogue);
  if (options.unreviewed) plan.groups[0].status = 'not-reviewed';
  if (options.ambiguous) {
    const q = catalogue.points.find(p => p.key === 'Teyvat:1354');
    q.arrival = { ...catalogue.points.find(p => p.key === 'Teyvat:1172').arrival };
  }
  const byKey = new Map(catalogue.points.map(p => [p.key, p]));
  const unlocked = new Set(options.allUnlocked ? catalogue.points.map(p => p.key) : ['Teyvat:1170', 'Teyvat:1166']);
  for (const key of options.locked || []) unlocked.delete(key);
  const history = [], writes = new Map();
  if (options.previousState !== undefined) writes.set('state.json', typeof options.previousState === 'string' ? options.previousState : JSON.stringify(options.previousState));
  let currentMap = options.initialMap || 'Teyvat';
  let current = { ...(byKey.get(options.initialKey || 'Teyvat:1166').arrival) };
  let time = Date.UTC(2026, 10, 4), storyReads = 0;
  const targetAt = () => catalogue.points.find(p => p.mapName === currentMap && p.scope === 'standard' && dist(current, p) < 9);
  function position(mapName, method) {
    history.push(['position', mapName, method]);
    if (options.cancelPosition) throw new Error('OperationCanceled');
    if (storyReads-- > 0 || options.nullPosition) return null;
    if (options.defaultError && method === 'default') throw new Error('原生匹配失败');
    if (options.zeroPosition) return { x: 0, y: 0 };
    if (mapName !== currentMap) throw new Error('Requested a different map');
    const delta = options.siftOffset && method === 'sift' ? 100 : 0;
    return options.uppercase ? { X: current.x + delta, Y: current.y } : { x: current.x + delta, y: current.y };
  }
  const host = {
    settings: { mode: options.mode || '执行已审阅路线', routeGroup: options.routeGroup || plan.groups[0].name,
      teleportTarget: options.teleportTarget || 'Teyvat:1166', diagnosticMap: options.diagnosticMap || 'Teyvat',
      auditArea: options.auditArea || '坚岩隘谷', storyTimeoutSeconds: '30', witnessKey: options.witnessKey || '' },
    Date: class extends Date { constructor(...args) { super(args.length ? args[0] : time); } static now() { return time; } },
    getVersion: () => options.version || '0.66.0',
    sleep: async ms => { history.push(['sleep', ms]); time += ms; },
    keyPress: key => {
      history.push(['press', key]);
      const p = targetAt();
      if (p && key === 'F' && !options.noUnlockAfterF) unlocked.add(p.key);
      if (p?.key === 'Teyvat:1172' && options.story) storyReads = options.storyTimeout ? 100 : 5;
    },
    keyDown: () => { throw new Error('Manual movement must not be sent'); },
    moveMouseBy: () => { throw new Error('Native navigation must control direction'); },
    log: { info: message => history.push(['info', message]), error: message => history.push(['error', message]) },
    file: {
      createDirectory: () => true,
      isExists: name => writes.has(name),
      readTextSync: name => {
        if (name === 'plan.json') return JSON.stringify(plan);
        if (name === 'catalogue.json') return JSON.stringify(catalogue);
        if (writes.has(name)) return writes.get(name);
        const text = fs.readFileSync(path.join(root, name), 'utf8');
        if ((options.wrongRouteMap || options.wrongMiddlePoint) && name.startsWith('routes/')) {
          const native = JSON.parse(text);
          if (options.wrongRouteMap) native.info.map_name = 'AncientSacredMountain';
          if (options.wrongMiddlePoint) native.positions[1].x += 500;
          return JSON.stringify(native);
        }
        return text;
      },
      writeTextSync: (name, value, append = false) => {
        history.push(['write', name]);
        if (options.failWrite === name) return false;
        writes.set(name, append ? (writes.get(name) || '') + value : value); return true;
      },
      writeImageSync: name => { history.push(['screenshot', name]); return true; }
    },
    RecognitionObject: { ocr: (...box) => box },
    captureGameRegion: () => ({ width: 1920, height: 1080, srcMat: {}, dispose() {}, findMulti(box) {
      history.push(['ocr', box]);
      const p = targetAt();
      const text = options.noPrompt ? '交谈' : (p?.type === 'Goddess' ? '七天神像' : '传送锚点');
      const rows = p ? [{ text, x: 1050, y: 400 }] : [];
      if (p && options.npcAbove) rows.unshift({ text: '附近的NPC', x: 1050, y: 360 });
      rows.count = rows.length; return rows;
    } }),
    genshin: {
      width: options.width || 2560, height: options.height || 1440, screenDpiScale: 1.5,
      getPositionFromMap: (mapName, cache) => { assert.equal(cache, 0); return position(mapName, 'default'); },
      getPositionFromMapWithMatchingMethod: (mapName, method, cache) => { assert.equal(method, 'SIFT'); assert.equal(cache, 0); return position(mapName, 'sift'); },
      getCameraOrientation: () => options.invalidOrientation ? null : 88,
      returnMainUi: async () => history.push(['main-ui']),
      clickMapPoint: () => { throw new Error('Generic map clicking must not be used'); },
      tp: async (...args) => {
        const [x, y, mapName = 'Teyvat'] = args;
        const p = catalogue.points.find(p => p.mapName === mapName && p.x === x && p.y === y);
        assert.ok(p, 'Teleport must use exact source map coordinates');
        history.push(['tp', p.key, args.length]);
        if (options.cancelTp === p.key) throw new Error('OperationCanceled');
        if (!unlocked.has(p.key) || options.failTp === p.key) {
          if (options.silentTp || options.silentFor === p.key) return;
          throw new Error('原生传送未完成');
        }
        if (options.wrongArrival === p.key) return;
        current = { ...p.arrival }; currentMap = p.mapName;
      }
    },
    pathingScript: { runFile: async name => {
      history.push(['path', name]);
      if (options.cancelPath) throw new Error('cancelled');
      if (options.silentPath) return;
      const native = JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
      current = { ...native.positions.at(-1) }; currentMap = native.info.map_name;
    } }
  };
  const task = () => vm.runInNewContext(source, host, { timeout: 3000 });
  return { task, history, writes, unlocked, state: () => JSON.parse(writes.get('state.json') || '{}') };
}

(async () => {
  let passed = 0;
  async function test(name, fn) { await fn(); console.log('PASS ' + name); passed++; }
  const act = m => m.history.filter(e => ['tp', 'path', 'press'].includes(e[0]));
  await test('three targets require real interaction, distant origin and native arrival', async () => {
    const m = mock(); await m.task();
    const state = m.state(); assert.equal(state.status, 'selected-group-verified');
    assert.deepEqual(Object.keys(state.completed).sort(), ['Teyvat:1167', 'Teyvat:1172', 'Teyvat:1177']);
    for (const proof of Object.values(state.completed)) {
      assert.equal(proof.kind, 'native-teleport-from-distant-witness'); assert.ok(dist(proof.from, proof.arrival) >= 36);
    }
    assert.equal(m.history.filter(e => e[0] === 'path').length, 3);
    assert.equal(m.history.filter(e => e[0] === 'press').length, 3);
  });
  await test('standing beside a locked point plus silent native returns cannot prove unlock', async () => {
    const m = mock({ initialKey: 'Teyvat:1172', silentTp: true, noUnlockAfterF: true });
    await assert.rejects(m.task(), /未通过原生传送核验/);
    assert.equal(m.state().completed['Teyvat:1172'], undefined);
    assert.ok(m.history.some(e => e[0] === 'path'));
    const trips = m.history.filter(e => e[0] === 'tp').map(e => e[1]);
    assert.equal(trips[0], 'Teyvat:1170'); assert.equal(trips[1], 'Teyvat:1172');
  });
  await test('native navigation returning without arrival cannot press F or advance', async () => {
    const m = mock({ silentPath: true }); await assert.rejects(m.task(), /落点/);
    assert.equal(m.history.filter(e => e[0] === 'press').length, 0);
    assert.equal(Object.keys(m.state().completed).length, 0);
  });
  await test('an NPC above the target blocks the F action', async () => {
    const m = mock({ npcAbove: true }); await assert.rejects(m.task(), /交互提示/);
    assert.equal(m.history.filter(e => e[0] === 'press').length, 0);
  });
  await test('unrelated prompt cannot be treated as the target', async () => {
    const m = mock({ noPrompt: true }); await assert.rejects(m.task(), /交互提示/);
    assert.equal(m.history.filter(e => e[0] === 'press').length, 0);
  });
  await test('silent target teleport failure after F leaves completion unknown', async () => {
    const m = mock({ failTp: 'Teyvat:1172', silentFor: 'Teyvat:1172' });
    await assert.rejects(m.task(), /未通过原生传送核验/); assert.equal(m.state().completed['Teyvat:1172'], undefined);
  });
  await test('wrong native arrival cannot create completion proof', async () => {
    const m = mock({ allUnlocked: true, wrongArrival: 'Teyvat:1172', noUnlockAfterF: true });
    await assert.rejects(m.task(), /未通过原生传送核验/); assert.equal(m.state().completed['Teyvat:1172'], undefined);
  });
  await test('camp story waits without dialogue/ability/movement keys and then continues', async () => {
    const m = mock({ story: true }); await m.task();
    assert.equal(m.state().status, 'selected-group-verified');
    assert.ok(m.history.some(e => e[0] === 'info' && e[1].includes('手动处理')));
    assert.ok(m.history.filter(e => e[0] === 'press').every(e => e[1] === 'F'));
  });
  await test('unresolved story times out with resumable state instead of moving on', async () => {
    const m = mock({ story: true, storyTimeout: true }); await assert.rejects(m.task(), /剧情等待超时/);
    assert.equal(m.state().activeKey, 'Teyvat:1172'); assert.equal(m.state().status, 'stopped');
    assert.equal(m.history.filter(e => e[0] === 'path').length, 1);
  });
  await test('unavailable start stops before navigation', async () => {
    const m = mock({ locked: ['Teyvat:1166'] }); await assert.rejects(m.task(), /起点/);
    assert.equal(m.history.filter(e => e[0] === 'path').length, 0);
  });
  await test('a stale checkpoint cannot skip fresh proof or survive a failed recheck', async () => {
    const previousState = { schemaVersion: 1, planRevision: originalPlan.revision, completed: { 'Teyvat:1172': { kind: 'old-proof' } }, attempts: {} };
    const m = mock({ previousState, noUnlockAfterF: true }); await assert.rejects(m.task(), /未通过原生传送核验/);
    assert.equal(m.state().completed['Teyvat:1172'], undefined); assert.ok(m.history.some(e => e[0] === 'path'));
  });
  await test('malformed checkpoint is ignored without skipping work', async () => {
    const m = mock({ previousState: '{broken' }); await m.task(); assert.equal(m.state().status, 'selected-group-verified');
  });
  await test('all already-open targets skip pathing only after live proof', async () => {
    const m = mock({ allUnlocked: true }); await m.task();
    assert.equal(m.history.filter(e => e[0] === 'path').length, 0); assert.equal(Object.keys(m.state().completed).length, 3);
  });
  await test('native path cancellation remains cancellation and records the exact fragment', async () => {
    const m = mock({ cancelPath: true }); await assert.rejects(m.task(), /cancelled/);
    assert.equal(m.state().status, 'cancelled'); assert.equal(m.state().activeSegment, '03-04-camp');
  });
  await test('native teleport cancellation is never downgraded to unknown and retried', async () => {
    const m = mock({ cancelTp: 'Teyvat:1170' }); await assert.rejects(m.task(), /OperationCanceled/);
    assert.equal(m.state().status, 'cancelled'); assert.equal(m.history.filter(e => e[0] === 'tp').length, 1);
  });
  await test('ambiguous XY arrivals cannot be marked complete even when unlocked', async () => {
    const m = mock({ ambiguous: true, allUnlocked: true }); await assert.rejects(m.task(), /未通过原生传送核验/);
    assert.equal(m.state().completed['Teyvat:1172'], undefined);
    assert.equal(m.history.filter(e => e[0] === 'tp' && e[1] === 'Teyvat:1172').length, 0);
  });
  await test('unreviewed group and wrong-map route are rejected before game actions', async () => {
    for (const options of [{ unreviewed: true }, { wrongRouteMap: true }, { wrongMiddlePoint: true }]) {
      const m = mock(options); await assert.rejects(m.task(), /审阅|不一致/); assert.equal(act(m).length, 0);
    }
  });
  await test('resolution and minimum BetterGI version gate all game actions', async () => {
    for (const options of [{ width: 1920, height: 1200 }, { version: '0.65.9' }]) {
      const m = mock(options); await assert.rejects(m.task(), /16:9|0.66/); assert.equal(act(m).length, 0);
    }
  });
  await test('native diagnostic reads coordinates only and preserves user checkpoint', async () => {
    const m = mock({ mode: '仅原生定位自检', previousState: 'keep-me', uppercase: true }); await m.task();
    assert.equal(act(m).length, 0); assert.equal(m.writes.get('state.json'), 'keep-me');
    const summary = JSON.parse(m.writes.get('native-check.json')).summary;
    assert.ok(summary.defaultStable && summary.siftStable && summary.matchersAgree && summary.orientationReadable);
  });
  await test('diagnostic distinguishes default failure, disagreeing SIFT and invalid values', async () => {
    for (const options of [{ defaultError: true }, { siftOffset: true }, { zeroPosition: true }, { invalidOrientation: true }]) {
      const m = mock({ mode: '仅原生定位自检', ...options }); await m.task();
      const s = JSON.parse(m.writes.get('native-check.json')).summary;
      if (options.defaultError) assert.ok(!s.defaultStable && s.siftStable);
      if (options.siftOffset) assert.ok(s.defaultStable && s.siftStable && !s.matchersAgree);
      if (options.zeroPosition) assert.ok(!s.defaultStable && !s.siftStable);
      if (options.invalidOrientation) assert.ok(!s.orientationReadable);
      assert.equal(act(m).length, 0);
    }
  });
  await test('independent native teleport test performs no script GPS/OCR/path/progress checks', async () => {
    const m = mock({ mode: '仅原生传送测试', nullPosition: true, previousState: 'keep-me' }); await m.task();
    assert.deepEqual(m.history.filter(e => ['tp', 'position', 'path', 'ocr', 'press'].includes(e[0])), [['tp', 'Teyvat:1166', 2]]);
    assert.equal(m.writes.get('state.json'), 'keep-me');
  });
  await test('Ancient Sacred Mountain native test uses the four-argument map overload', async () => {
    const m = mock({ mode: '仅原生传送测试', allUnlocked: true, teleportTarget: 'AncientSacredMountain:2' }); await m.task();
    assert.deepEqual(m.history.filter(e => e[0] === 'tp'), [['tp', 'AncientSacredMountain:2', 4]]);
  });
  await test('independent-map diagnostic consistently uses its own map name', async () => {
    const m = mock({ mode: '仅原生定位自检', initialKey: 'AncientSacredMountain:2', initialMap: 'AncientSacredMountain', diagnosticMap: 'AncientSacredMountain' });
    await m.task(); assert.ok(JSON.parse(m.writes.get('native-check.json')).summary.defaultStable);
    assert.ok(m.history.filter(e => e[0] === 'position').every(e => e[1] === 'AncientSacredMountain'));
  });
  await test('area audit uses remote origins and reports failure as unknown without F/pathing', async () => {
    const m = mock({ mode: '核验分区已开点', allUnlocked: true, auditArea: '万火之瓯', locked: ['Teyvat:1167'] }); await m.task();
    const report = JSON.parse(m.writes.get('unlock-report.json'));
    assert.equal(report.results.find(r => r.key === 'Teyvat:1167').status, 'unknown');
    assert.ok(report.results.some(r => r.status === 'verified')); assert.equal(m.history.filter(e => ['path', 'press'].includes(e[0])).length, 0);
  });
  await test('independent-map audit never issues Teyvat teleports or Teyvat position reads', async () => {
    const m = mock({ mode: '核验分区已开点', auditArea: '远古圣山', allUnlocked: true }); await m.task();
    assert.ok(m.history.filter(e => e[0] === 'tp').every(e => e[1].startsWith('AncientSacredMountain:') && e[2] === 4));
    assert.ok(m.history.filter(e => e[0] === 'position').every(e => e[1] === 'AncientSacredMountain'));
    assert.equal(JSON.parse(m.writes.get('unlock-report.json')).results.length, 19);
  });
  await test('wrong-map configured witness cannot cause a cross-map verification', async () => {
    const m = mock({ witnessKey: 'AncientSacredMountain:2' }); await assert.rejects(m.task(), /起点/); assert.equal(act(m).length, 0);
  });
  await test('checkpoint write failure prevents navigation and completion', async () => {
    const m = mock({ failWrite: 'state.json' }); await assert.rejects(m.task(), /保存断点/); assert.equal(act(m).length, 0);
  });
  console.log(`${passed} Natlan host simulation checks passed`);
})().catch(e => { console.error(e); process.exitCode = 1; });
