/* BetterGI >=0.66.0. No eval, external service, CommonJS, or infinite retries. */
(async function () {
  'use strict';
  const plan = JSON.parse(file.readTextSync('plan.json'));
  const target = number => plan.targets.find(item => item.number === number);
  const leg = id => plan.legs.find(item => item.id === id);
  const ranges = { '2—10': [2, 10], '4—10': [4, 10], '6—10': [6, 10], '仅6→7': [7, 7], '仅4号': [4, 4], '仅5→6': [6, 6] };
  const range = ranges[settings.range || '2—10'];
  if (!range || plan.schemaVersion !== 1) throw new Error('执行范围或路线版本无效。');
  const version = getVersion().replace(/^v/, '').split('.').map(part => parseInt(part, 10) || 0);
  if (version[0] === 0 && version[1] < 66) throw new Error('需要 BetterGI 0.66.0 或更新版本。');
  const storyLimit = Math.max(30, Math.min(600, Number(settings.storyTimeoutSeconds) || 180)) * 1000;
  const runId = new Date().toISOString().replace(/[^0-9T]/g, '');
  let stage = 0, lastLeg = '', state = { schemaVersion: 1, sourceSha256: plan.source.sourceSha256, completed: {} };
  const held = new Set();

  function error(message, code) { const e = new Error(message); e.code = code; return e; }
  function release() { for (const key of held) { try { keyUp(key); } catch (_) {} } held.clear(); }
  async function hold(key, ms) {
    held.add(key); keyDown(key);
    try { await sleep(ms); } finally { keyUp(key); held.delete(key); }
  }
  function checkpoint(extra) {
    Object.assign(state, { activeTarget: stage, lastLeg, updatedAt: new Date().toISOString() }, extra || {});
    if (!file.writeTextSync('state.json', JSON.stringify(state, null, 2))) throw error('无法保存断点 state.json。', 'IO');
  }
  function record(type, detail) {
    const event = { time: new Date().toISOString(), type, target: stage, leg: lastLeg, detail };
    if (!file.writeTextSync(`logs/${runId}.jsonl.txt`, JSON.stringify(event) + '\n', true)) throw error('无法保存运行日志。', 'IO');
  }
  function snapshot(label) {
    const image = captureGameRegion();
    try { return file.writeImageSync(`logs/${runId}-${stage}-${label}.png`, image.srcMat); }
    finally { image.dispose(); }
  }
  function ocrBox(box) {
    const image = captureGameRegion();
    try {
      const results = image.findMulti(RecognitionObject.ocr(
        Math.round(box[0]*image.width), Math.round(box[1]*image.height),
        Math.round(box[2]*image.width), Math.round(box[3]*image.height)));
      const items = [];
      for (let i = 0; i < results.count; i++) {
        const item = results[i];
        items.push({ text: String(item.text || '').replace(/\s/g, ''), x: item.x, y: item.y, width: item.width, height: item.height });
      }
      return items;
    } finally { image.dispose(); }
  }
  function position() {
    try {
      const point = genshin.getPositionFromMap('Teyvat', 0);
      if (!point || !Number.isFinite(Number(point.X)) || !Number.isFinite(Number(point.Y)) || (Number(point.X) === 0 && Number(point.Y) === 0)) return null;
      return { x: Number(point.X), y: Number(point.Y) };
    } catch (_) { return null; }
  }
  function distance(a, b) { return Math.hypot(a.x-b.x, a.y-b.y); }
  async function stablePosition(expected, tolerance) {
    let previous = null;
    for (let i = 0; i < 6; i++) {
      const p = position();
      if (p && previous && distance(p, previous) <= 8 && (!expected || distance(p, expected) <= tolerance)) return p;
      previous = p; await sleep(300);
    }
    throw error('未取得稳定且符合预期的地图位置，停止移动。', 'GPS');
  }

  // A pathing promise can return after logging an error. Verify every fragment's
  // terminal position independently; do not race a live native task against a timer.
  async function navigate(id, tolerance) {
    release(); lastLeg = id; checkpoint(); record('navigate-start', id);
    const data = leg(id);
    if (!data || !data.points.length) throw error('缺少路线片段：' + id, 'DATA');
    await pathingScript.runFile(`routes/${id}.json`);
    release(); await sleep(500);
    const p = await stablePosition(data.points[data.points.length-1], tolerance || 10);
    record('navigate-arrived', p);
    return p;
  }

  async function rotate(degrees) {
    for (let attempt = 0; attempt < 35; attempt++) {
      const current = Number(genshin.getCameraOrientation());
      if (!Number.isFinite(current)) throw error('无法识别镜头朝向。', 'GPS');
      const difference = ((current-degrees+540)%360)-180;
      if (Math.abs(difference) <= 5) return;
      const gain = Math.abs(difference)>90 ? 4 : Math.abs(difference)>30 ? 3 : 2;
      moveMouseBy(Math.round(-gain*difference), 0); await sleep(80);
    }
    throw error('镜头转向未达到要求。', 'NAV');
  }
  function bearing(from, to) {
    // Route X increases west, Y north. CameraOrientation uses screen axes.
    return (Math.atan2(-(to.y-from.y), -(to.x-from.x))*180/Math.PI+360)%360;
  }

  // Short foreground movement for the story-sensitive valley. Each key burst is
  // released before OCR/GPS polling, so dialogue immediately stops movement.
  async function walkForeground(id, tolerance) {
    release(); lastLeg = id; checkpoint();
    for (const point of leg(id).points) {
      const began = Date.now(); let best = Infinity, progressed = began;
      while (true) {
        const p = position();
        if (!p) throw error('剧情或地图识别中断。', 'GPS');
        const d = distance(p, point);
        if (d <= (tolerance || 6)) break;
        if (d > 100) throw error('当前位置偏离当前路线片段。', 'NAV');
        if (d < best-1) { best = d; progressed = Date.now(); }
        if (Date.now()-began > 45000 || Date.now()-progressed > 9000) throw error('山谷路段没有取得进展。', 'NAV');
        await rotate(bearing(p, point)); await hold('W', 250);
      }
    }
  }

  async function teleport(number) {
    release(); const point = target(number);
    record('teleport', { number, tpId: point.tpId });
    await genshin.returnMainUi();
    await genshin.tp(point.x, point.y, true);
    await sleep(1200);
    return stablePosition(point, 28);
  }

  async function mapState(number) {
    release(); const point = target(number);
    try {
      await genshin.clickMapPoint(point.x, point.y);
      await sleep(700);
      const panel = ocrBox([.66, .02, .34, .96]);
      const footer = ocrBox([.70, .75, .30, .25]);
      const titleOk = panel.some(item => number === 9 ? item.text.includes('无光的深都') : number === 3 ? /新月神像|七天神像/.test(item.text) : item.text.includes('传送锚点'));
      const locked = panel.some(item => /尚未解锁|未解锁|未激活/.test(item.text));
      const button = footer.some(item => item.text === '传送');
      const result = titleOk && button && !locked ? 'unlocked' : titleOk ? 'locked' : 'unknown';
      record('map-check', { number, result, panel: panel.map(item => item.text), footer: footer.map(item => item.text) });
      return result;
    } finally { await genshin.returnMainUi(); await sleep(300); }
  }

  function interactionRow(pattern) {
    const rows = ocrBox([.48, .20, .35, .56]);
    const candidates = rows.filter(item => pattern.test(item.text));
    if (!candidates.length) return null;
    const chosen = candidates.sort((a,b) => a.y-b.y)[0];
    // F activates the first row. Refuse to press it when a different readable
    // interaction is above the desired row; don't accidentally talk to an NPC.
    const competing = rows.some(item => item.y < chosen.y-8 && item.y > chosen.y-85 &&
      Math.abs(item.x-chosen.x) < 100 && item.text && item.text !== 'F');
    return competing ? null : chosen;
  }
  async function pressWhenVisible(pattern, timeout) {
    const began = Date.now();
    while (Date.now()-began < timeout) {
      if (interactionRow(pattern)) { keyPress('F'); await sleep(500); return true; }
      await sleep(250);
    }
    return false;
  }
  async function unlock(number) {
    release();
    const expected = number === 9 ? /无光的深都/ : /传送锚点/;
    if (!await pressWhenVisible(expected, 5000)) {
      // A point may have opened while approaching; still require fresh map proof.
      if (await mapState(number) === 'unlocked') return;
      throw error(`${number}号点未出现正确交互提示。`, 'INTERACTION');
    }
    await sleep(1300);
    if (await mapState(number) !== 'unlocked') throw error(`${number}号交互后未确认可传送，未记为完成。`, 'VERIFY');
  }
  async function complete(number) {
    state.completed[String(number)] = { verifiedAt: new Date().toISOString(), proof: 'selected-map-panel-exact-teleport-button' };
    checkpoint({ lastVerifiedTarget: number }); record('target-verified', number);
    log.info(`${number}号点已核验可传送。`);
  }

  async function liftToRoof() {
    await navigate('04-lift-approach', 8);
    for (let floor = 0; floor < 2; floor++) {
      if (!await pressWhenVisible(/^上行$/, 6000)) throw error('升降台未出现上行选项。', 'LIFT');
      // Source has two separate upper-floor requests, not one 30s blind wait.
      await sleep(floor === 0 ? 7000 : 22000);
      record('lift-up', { floor: floor+1 });
    }
    const p = await stablePosition(plan.special.lift, 10);
    await rotate(bearing(p, target(4)));
    for (let i = 0; i < 20; i++) {
      if (interactionRow(/传送锚点/)) return;
      await hold('W', 200);
    }
    throw error('升降台出口未找到4号锚点，可能未到最上层。', 'LIFT');
  }

  async function dropToFive() {
    const p = await navigate('05-glide', 12);
    if (distance(p, target(5)) > 30) throw error('未抵达5号点上方崖边。', 'NAV');
    await rotate(bearing(p, target(5)));
    // The final short descent can enter an unrevealed cave minimap. Keep it
    // bounded and require the actual waypoint F prompt before declaring arrival.
    for (let i = 0; i < 20; i++) {
      if (interactionRow(/传送锚点/)) return;
      await hold('W', 200);
    }
    throw error('崖下未找到5号锚点交互。', 'INTERACTION');
  }

  async function recoverIntro() {
    release(); record('story-wait', '停止移动，等待剧情回到主界面');
    const began = Date.now(); let stable = 0, previous = null;
    while (Date.now()-began < storyLimit) {
      const p = position();
      stable = p && previous && distance(p, previous) < 5 ? stable+1 : 0;
      previous = p;
      if (stable >= 6) {
        await teleport(5); checkpoint({ storyRecoveredAt: new Date().toISOString() });
        record('story-recovered', '返回5号，沿十字路口左转路线继续'); return;
      }
      await sleep(1500);
    }
    throw error('剧情等待超时。请处理当前对话或过场后，从“仅5→6”续跑。', 'STORY');
  }
  async function valleyToSix() {
    dispatcher.addTimer(new RealtimeTimer('AutoSkip'));
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          await walkForeground('06-valley'); await walkForeground('06-spirit-approach', 2.5);
          // The source explicitly uses T for 空月之灵; this is not a character skill.
          keyPress('T'); await sleep(600); keyPress('SPACE'); await sleep(500);
          await navigate('06-platform', 10); return;
        } catch (e) {
          release();
          if (attempt || !['GPS','NAV'].includes(e.code)) throw e;
          snapshot('story-or-position-interruption'); await recoverIntro();
        }
      }
    } finally { release(); dispatcher.clearAllTriggers(); }
  }

  try {
    if (file.isExists('state.json')) {
      try {
        const previous = JSON.parse(file.readTextSync('state.json'));
        if (previous.schemaVersion === 1 && previous.sourceSha256 === state.sourceSha256 && previous.completed && typeof previous.completed === 'object') state = previous;
      } catch (_) { /* A malformed checkpoint cannot skip live verification. */ }
    }
    file.createDirectory('logs'); checkpoint({ runId, selectedRange: range, status: 'running' });
    record('run-start', { version: getVersion(), range, source: plan.source.sourceSha256 });
    stage = 3;
    if (await mapState(3) !== 'unlocked') throw error('未核验伦波岛神像已点亮；此版本要求神像已亮并能进行地图定位。', 'PREREQUISITE');
    await complete(3);
    for (stage = range[0]; stage <= range[1]; stage++) {
      checkpoint();
      if (stage === 3) continue;
      if (await mapState(stage) === 'unlocked') { await complete(stage); continue; }
      if (stage === 2) { await teleport(1); await navigate('02-town', 9); }
      else if (stage === 4) { await teleport(2); await liftToRoof(); }
      else if (stage === 5) { await teleport(4); await dropToFive(); }
      else if (stage === 6) { await teleport(5); await valleyToSix(); }
      else if (stage === 7) { await teleport(6); await navigate('07-road', 9); }
      else if (stage === 8) { await teleport(7); await navigate('08-ledge', 10); await navigate('08-flight', 10); }
      else if (stage === 9) { await teleport(7); await navigate('09-domain', 10); }
      else if (stage === 10) { await teleport(6); await navigate('10-uphill', 10); await navigate('10-drop', 10); }
      await unlock(stage); await complete(stage);
    }
    checkpoint({ status: 'selected-range-verified', activeTarget: null });
    log.info('本次选择范围内的目标已逐点核验可传送。');
  } catch (e) {
    release();
    try { snapshot('failed'); } catch (_) {}
    try { checkpoint({ status: 'stopped', lastError: String(e.message || e) }); record('stopped', String(e.message || e)); } catch (_) {}
    log.error('开图停止：' + String(e.message || e));
    throw e;
  } finally { release(); }
})();
