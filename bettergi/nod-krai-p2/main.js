/* BetterGI >=0.66.0. No eval, external service, CommonJS, or infinite retries. */
(async function () {
  'use strict';
  const plan = JSON.parse(file.readTextSync('plan.json'));
  const target = number => plan.targets.find(item => item.number === number);
  const leg = id => plan.legs.find(item => item.id === id);
  const mode = settings.mode || '仅原生定位自检';
  if (!['仅原生定位自检', '仅原生传送测试', '执行开图路线'].includes(mode)) throw new Error('运行模式无效。');
  const diagnostic = mode !== '执行开图路线';
  const ranges = { '2—10': [2, 10], '4—10': [4, 10], '6—10': [6, 10], '仅6→7': [7, 7], '仅4号': [4, 4], '仅5→6': [6, 6] };
  const range = ranges[settings.range || '2—10'];
  if (!range || plan.schemaVersion !== 1) throw new Error('执行范围或路线版本无效。');
  const version = getVersion().replace(/^v/, '').split('.').map(part => parseInt(part, 10) || 0);
  if (version[0] === 0 && version[1] < 66) throw new Error('需要 BetterGI 0.66.0 或更新版本。');
  const storyLimit = Math.max(30, Math.min(600, Number(settings.storyTimeoutSeconds) || 180)) * 1000;
  const runId = new Date().toISOString().replace(/[^0-9T]/g, '');
  let stage = 0, lastLeg = '', state = { schemaVersion: 1, sourceSha256: plan.source.sourceSha256, completed: {} };
  const held = new Set();
  const proofs = new Map();
  let lastPositionReason = null;

  function error(message, code) { const e = new Error(message); e.code = code; return e; }
  function stopped(e) { return /cancel|取消|中止|ScriptInterrupted/i.test(String(e && (e.message || e))); }
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
  function checkEnvironment() {
    const gameWidth = Number(genshin.width), gameHeight = Number(genshin.height);
    const dpi = Number(genshin.screenDpiScale);
    const environment = { gameWidth, gameHeight, captureWidth: null, captureHeight: null,
      screenDpiScale: Number.isFinite(dpi) ? dpi : null };
    if (!Number.isInteger(gameWidth) || !Number.isInteger(gameHeight) || gameWidth <= 0 || gameHeight <= 0) {
      record('environment', environment);
      throw error('无法读取 BetterGI 检测到的游戏客户区尺寸，请重新捕获原神窗口。', 'RESOLUTION');
    }
    if (gameWidth*9 !== gameHeight*16) {
      record('environment', environment);
      throw error(`BetterGI 检测到的游戏客户区为 ${gameWidth}×${gameHeight}，不符合16:9。请调整游戏窗口或重新捕获；1920×1080和2560×1440均可。`, 'RESOLUTION');
    }
    const image = captureGameRegion();
    try { environment.captureWidth = image.width; environment.captureHeight = image.height; }
    finally { image.dispose(); }
    record('environment', environment);
    log.info(`窗口检查通过：${gameWidth}×${gameHeight}；识别截图 ${environment.captureWidth}×${environment.captureHeight}。`);
    return environment;
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
  function nativePoint(point) {
    // Both aliases are exposed by BetterGI; prefer the script repository's x/y.
    const x = point && (point.x === undefined ? point.X : point.x);
    const y = point && (point.y === undefined ? point.Y : point.y);
    if (x == null || y == null || !Number.isFinite(Number(x)) || !Number.isFinite(Number(y)) || (Number(x) === 0 && Number(y) === 0)) return null;
    return { x: Number(x), y: Number(y) };
  }
  function position() {
    try {
      const point = nativePoint(genshin.getPositionFromMap('Teyvat', 0));
      if (!point) {
        lastPositionReason = '地图定位返回空值或无效坐标'; return null;
      }
      lastPositionReason = null;
      return point;
    } catch (e) { if (stopped(e)) throw e; lastPositionReason = String(e.message || e); return null; }
  }
  function distance(a, b) { return Math.hypot(a.x-b.x, a.y-b.y); }
  async function checkNativePosition(environment) {
    const report = { schemaVersion: 1, checkedAt: new Date().toISOString(), bgiVersion: getVersion(), environment, samples: [], summary: null };
    const read = fn => {
      try {
        const value = fn();
        if (value == null) return { ok: false, reason: '原生接口返回空值或无效值' };
        return { ok: true, value };
      } catch (e) { if (stopped(e)) throw e; return { ok: false, reason: String(e.message || e) }; }
    };
    function stable(method) {
      // Repeated native readings can establish consistency, not absolute accuracy.
      return report.samples.length === 4 && report.samples.every((sample, i, list) =>
        sample[method].ok && (!i || distance(sample[method].value, list[i-1][method].value) <= 8));
    }
    const describe = result => result.ok ? `(${result.value.x.toFixed(2)}, ${result.value.y.toFixed(2)})` : result.reason;
    try {
      log.info('仅原生定位自检：请保持角色静止、停留在游戏主界面。');
      for (let i = 0; i < 4; i++) {
        const sample = {
          default: read(() => nativePoint(genshin.getPositionFromMap('Teyvat', 0))),
          sift: read(() => nativePoint(genshin.getPositionFromMapWithMatchingMethod('Teyvat', 'SIFT', 0))),
          orientation: read(() => {
            const angle = genshin.getCameraOrientation();
            return typeof angle === 'number' && Number.isFinite(angle) && angle >= 0 && angle < 360 ? angle : null;
          })
        };
        report.samples.push(sample); record('native-check-sample', sample);
        log.info(`原生自检 ${i+1}/4：默认=${describe(sample.default)}；SIFT=${describe(sample.sift)}；朝向=${sample.orientation.ok ? sample.orientation.value.toFixed(1)+'°' : sample.orientation.reason}`);
        if (i < 3) await sleep(350);
      }
      const defaultStable = stable('default'), siftStable = stable('sift');
      const orientationReadable = report.samples.every(sample => sample.orientation.ok);
      const matchersAgree = defaultStable && siftStable && report.samples.every(sample => distance(sample.default.value, sample.sift.value) <= 8);
      report.summary = { defaultStable, siftStable, orientationReadable, matchersAgree };
      log.info(`原生自检结果：默认定位=${defaultStable ? '连续稳定' : '失败或不稳定'}；SIFT=${siftStable ? '连续稳定' : '失败或不稳定'}；朝向=${orientationReadable ? '可读取' : '读取失败'}。`);
      if (defaultStable && siftStable && !matchersAgree) log.info('两种匹配得到的位置不一致，请核对实际站位和地图资源后再执行开图。');
      if (!defaultStable && siftStable) log.info('SIFT 连续定位成功：请在 BetterGI 的地图追踪设置中选择 SIFT，再运行自检。脚本不会修改你的全局配置。');
      if (!defaultStable && !siftStable) log.info('BetterGI 原生定位未得到连续稳定结果，请先检查游戏主界面、小地图方向、捕获窗口与地图资源。');
    } finally {
      if (!file.writeTextSync('native-check.json', JSON.stringify(report, null, 2))) throw error('无法保存原生自检报告。', 'IO');
    }
    log.info('原生自检结束，报告保存在脚本文件夹 native-check.json；此模式不会传送或执行路线。');
  }
  async function stablePosition(expected, tolerance) {
    let previous = null;
    for (let i = 0; i < 6; i++) {
      const p = position();
      if (p && previous && distance(p, previous) <= 8 && (!expected || distance(p, expected) <= tolerance)) return p;
      previous = p; await sleep(300);
    }
    record('position-verification-failed', { expected, tolerance, lastPosition: previous, reason: lastPositionReason });
    throw error('未取得稳定且符合预期的地图位置，停止移动。', 'GPS');
  }

  // A pathing promise can return after logging an error. Verify every fragment's
  // terminal position independently; do not race a live native task against a timer.
  async function navigate(id, tolerance) {
    release(); lastLeg = id; checkpoint(); record('navigate-start', id);
    const data = leg(id);
    if (!data || !data.points.length) throw error('缺少路线片段：' + id, 'DATA');
    const before = await stablePosition(null, 0);
    if (distance(before,data.points[0]) > 35) throw error(`路线${id}起点相差超过35，停止接线。`, 'NAV');
    const chunks = data.nativeChunks || [{ file: `routes/${id}.json`, end: data.points[data.points.length-1] }];
    let p;
    for (let i = 0; i < chunks.length; i++) {
      record('navigate-chunk-start', { index: i+1, total: chunks.length, file: chunks[i].file });
      await pathingScript.runFile(chunks[i].file);
      release(); await sleep(250);
      p = await stablePosition(chunks[i].end, Math.min(tolerance || 6, 6));
      record('navigate-chunk-arrived', { index: i+1, position: p });
    }
    record('navigate-arrived', p);
    return p;
  }

  function bearing(from, to) {
    // Only a postcondition, never a mouse controller. Native orientation points
    // perform the actual conversion, recognition, DPI scaling and camera motion.
    return (Math.atan2(-(to.y-from.y), -(to.x-from.x))*180/Math.PI+360)%360;
  }
  async function faceTo(point) {
    release();
    const before = await stablePosition(null, 0);
    await pathingScript.run(JSON.stringify({
      info: { name: '原生方位点', type: 'collect', bgi_version: '0.66.0', map_name: 'Teyvat' },
      positions: [{ x: point.x, y: point.y, type: 'orientation', move_mode: 'walk', action: '' }]
    }));
    // Native tasks may log a failure and return. Do not walk forward unless the
    // camera really faces the target and the character stayed in place.
    const after = await stablePosition(before, 8);
    const angle = genshin.getCameraOrientation();
    const expected = bearing(after, point);
    const difference = Math.abs(((angle-expected+540)%360)-180);
    record('native-orientation', { target: { x: point.x, y: point.y }, angle, expected, difference });
    if (typeof angle !== 'number' || !Number.isFinite(angle) || distance(after, point) < 1 || difference > 8) {
      throw error('BetterGI 原生方位点未通过朝向核验，停止向前移动。', 'NAV');
    }
  }

  async function teleport(number) {
    release(); const point = target(number);
    record('teleport', { number, tpId: point.tpId });
    await genshin.returnMainUi();
    // Use the target-aware teleport API, with its icon correction and scaling.
    // Generic clickMapPoint only projects a world coordinate to a screen point.
    await genshin.tp(point.x, point.y);
    await sleep(1200);
    return stablePosition(point, 28);
  }

  async function startAtOne() {
    release(); await genshin.returnMainUi();
    // This flat initial dock is the only start that may be reused. Do not use
    // 2D proximity to skip roof/cave return teleports, or as unlock evidence.
    const first = position();
    if (first && distance(first, target(1)) <= 20) {
      const p = await stablePosition(target(1), 20);
      record('reuse-current-start', { number: 1, position: p });
      log.info('已在1号起点附近，直接开始1→2，不重复打开地图传送。');
      return p;
    }
    return teleport(1);
  }

  async function nativeTeleportTest() {
    const number = Number(settings.teleportTarget || '1');
    if (![1, 3].includes(number)) throw error('原生传送测试只支持已确认开放的1号或3号点。', 'DATA');
    const point = target(number); stage = number;
    record('native-teleport-test-start', { number, x: point.x, y: point.y });
    log.info(`直接调用 BetterGI 原生 genshin.tp(${point.x}, ${point.y})；目标${number}号。本模式不运行脚本的地图点选、OCR或路线。`);
    await genshin.returnMainUi();
    // Genshin.Tp directly awaits new TpTask(token).Tp(x, y). Keep this probe
    // independent of script GPS postconditions and all custom map UI logic.
    await genshin.tp(point.x, point.y);
    record('native-teleport-test-returned', { number });
    log.info('BetterGI 原生传送接口已返回；测试结束，未写开图完成记录。');
  }

  async function verifyByTeleport(number) {
    try {
      const p = await teleport(number);
      proofs.set(number, 'native-teleport-and-stable-position');
      record('teleport-verified', { number, position: p });
      return 'unlocked';
    } catch (e) {
      if (stopped(e)) throw e;
      record('teleport-verification-unknown', { number, reason: String(e.message || e) });
      throw error(`${number}号点无法通过原生传送和位置核验确认；请检查图标识别、窗口捕获和地图资源，不能据此判定未解锁。原因：${String(e.message || e)}`, 'VERIFY_UNKNOWN');
    }
  }

  async function probeUnlock(number) {
    release();
    proofs.delete(number);
    try {
      // Delegate map projection, icon alignment, candidate selection and confirm
      // to TpTask through its public JS wrapper. No generic map clicks or OCR.
      return await verifyByTeleport(number);
    } catch (e) {
      if (stopped(e)) throw e;
      record('native-unlock-probe-unknown', { number, reason: String(e.message || e) });
      return 'unknown';
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
      if (await probeUnlock(number) === 'unlocked') return;
      throw error(`${number}号点未出现正确交互提示。`, 'INTERACTION');
    }
    await sleep(1300);
    if (await probeUnlock(number) !== 'unlocked') throw error(`${number}号交互后原生传送未确认到达，未记为完成。请查看 BetterGI 日志中的原生传送异常与调用栈。`, 'VERIFY');
  }
  async function complete(number) {
    const proof = proofs.get(number);
    if (!proof) throw error(`${number}号缺少本次运行的实际核验结果。`, 'VERIFY');
    state.completed[String(number)] = { verifiedAt: new Date().toISOString(), proof };
    checkpoint({ lastVerifiedTarget: number }); record('target-verified', number);
    log.info(`${number}号点已核验可传送。`);
  }

  async function liftToRoof() {
    await navigate('04-lift-approach', 8);
    for (let floor = 0; floor < 2; floor++) {
      if (!await pressWhenVisible(/^上行$/, floor === 0 ? 6000 : 20000)) throw error('升降台未出现上行选项，未继续按F。', 'LIFT');
      let activated = false;
      const began = Date.now();
      while (Date.now()-began < 4000) {
        if (ocrBox([.32,.16,.40,.30]).some(item => /升降机已启动/.test(item.text))) { activated = true; break; }
        await sleep(200);
      }
      if (!activated) throw error('未识别到“升降机已启动”，不能确认上行交互生效。', 'LIFT');
      record('lift-up', { floor: floor+1 });
      // The next request is gated by the reappearing 上行 option. The final
      // source-observed ride still has a settling bound; it does not prove Z.
      if (floor === 1) await sleep(22000);
    }
    await stablePosition(plan.special.lift, 10);
    await faceTo(target(4));
    for (let i = 0; i < 20; i++) {
      if (interactionRow(/传送锚点/)) return;
      await hold('W', 200);
    }
    throw error('升降台出口未找到4号锚点，可能未到最上层。', 'LIFT');
  }

  async function dropToFive() {
    const p = await navigate('05-glide', 12);
    if (distance(p, target(5)) > 30) throw error('未抵达5号点上方崖边。', 'NAV');
    await faceTo(target(5));
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
          await navigate('06-valley', 6); await navigate('06-spirit-approach', 2.5);
          // The source changes to 空月之灵 here, then returns to a character on
          // the upper steps. This variant follows the same ramp on foot. Do not
          // toggle an unknown current form, or call the ramp a climbing wall.
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
    if (!diagnostic && file.isExists('state.json')) {
      try {
        const previous = JSON.parse(file.readTextSync('state.json'));
        if (previous.schemaVersion === 1 && previous.sourceSha256 === state.sourceSha256 && previous.completed && typeof previous.completed === 'object') state = previous;
      } catch (_) { /* A malformed checkpoint cannot skip live verification. */ }
    }
    file.createDirectory('logs');
    record('run-start', { version: getVersion(), packageVersion: plan.packageVersion, mode, range, source: plan.source.sourceSha256 });
    log.info(`伦波岛开图 P2 ${plan.packageVersion}；${mode}。`);
    const environment = checkEnvironment();
    if (mode === '仅原生定位自检') { await checkNativePosition(environment); return; }
    if (mode === '仅原生传送测试') { await nativeTeleportTest(); return; }
    checkpoint({ runId, selectedRange: range, status: 'running' });
    // The user confirmed that the statue is lit. Opening its map panel is not a
    // prerequisite for native minimap localization or for the selected leg.
    // Do not manufacture a live completion proof for this skipped prerequisite.
    await genshin.returnMainUi();
    record('native-initial-position', await stablePosition(null, 0));
    log.info('按账号前提跳过3号神像点选与传送；从所选路段开始，不新增神像核验记录。');
    for (stage = range[0]; stage <= range[1]; stage++) {
      checkpoint();
      if (stage === 3) continue;
      if (await probeUnlock(stage) === 'unlocked') { await complete(stage); continue; }
      if (stage === 2) { await startAtOne(); await navigate('02-town', 9); }
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
    if (!diagnostic) {
      try { snapshot('failed'); } catch (_) {}
      try { checkpoint({ status: 'stopped', lastError: String(e.message || e) }); } catch (_) {}
    }
    try { record('stopped', String(e.message || e)); } catch (_) {}
    log.error(`${mode}停止：` + String(e.message || e));
    throw e;
  } finally { release(); }
})();
