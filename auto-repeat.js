(() => {
  'use strict';
  const KEY = Symbol.for('tamacolle-kor-auto-repeat.v1');
  if (globalThis[KEY]) return;
  const BUSY = ['isChanging', 'isLoading', 'isAnimation', 'isFade', 'isServerAccess', 'isSaving', 'isSave', 'isEventLoading'];
  const INPUT = ['isConfirm', 'isInfo', 'isSelect', 'isOption', 'isMainMenu', 'isNews', 'isTutorial', 'isEquip', 'isQuick', 'isEvent', 'isAutoEvent'];
  const REQUIRED = {
    stage: ['StartChapter', 'DirectSet', 'ChapterBtnPushPrepare', 'SyutsujinBtnPush'],
    end: ['CheckChapterClear', 'Finish', 'ShowDecision', 'HideDecision', 'TouchHomeBtn', 'TouchStageBtn'],
    result: ['BattleResultSuccess', 'ShowBackBtn', 'TouchHomeBtn', 'Approval', 'SetResultState'],
    info: ['Alert', 'Error']
  };

  function create({getEngine, now = Date.now} = {}) {
    let available = false, disposed = false, faulted = false, binding = null, hooks = [];
    let checked = false, reason = '', phase = 'idle', completed = 0, deadline = 0, due = 0, reasonUntil = 0;
    let snapshot = null, serial = 0, missionSerial = -1, serverSerial = -1, readySerial = -1, approvedSerial = -1, menuSerial = -1;
    let menuEligible = false, internal = 0, finishing = 0, finishDecision = false;
    let toggle = null, prepareToggle = null, middleToggle = null, stopControl = null, reasonNode = null, reasonLabel = null, lastPaint = '';
    const homeActions = new Set();
    const doc = globalThis.document;
    let pausedAt = null, pausedFor = 0;
    const valid = value => !!value && (!binding?.cc.isValid || binding.cc.isValid(value));
    const child = (node, name) => node?.children?.find(value => value.name === name);
    const hidden = () => doc?.hidden === true;
    function time() {
      const current = now();
      if (hidden()) {
        if (pausedAt === null) pausedAt = current;
        return pausedAt - pausedFor;
      }
      if (pausedAt !== null) {
        pausedFor += current - pausedAt;
        pausedAt = null;
      }
      return current - pausedFor;
    }

    function state(next, timeout = 0) {
      phase = next;
      deadline = timeout ? time() + timeout : 0;
      paint();
    }
    function stop(text) {
      checked = false;
      due = 0;
      reason = text;
      reasonUntil = now() + 3000;
      state(disposed ? 'disposed' : 'stopped');
    }
    function featureError(error) {
      faulted = true;
      try { stop('반복 중지: 게임 API 오류가 발생했습니다.'); }
      catch (_) { checked = false; phase = 'stopped'; }
      globalThis.console?.error?.('[tamacolle-kor repeat]', error);
    }
    function owns(hook) {
      const descriptor = Object.getOwnPropertyDescriptor(hook.owner, hook.name);
      return !!descriptor && ['value', 'writable', 'enumerable', 'configurable'].every(key => descriptor[key] === hook.installed[key]);
    }
    function restore(records) {
      for (let i = records.length - 1; i >= 0; i--) {
        const h = records[i];
        if (!owns(h)) continue;
        if (h.own) Object.defineProperty(h.owner, h.name, h.own);
        else delete h.owner[h.name];
      }
    }
    function wrap(owner, name, around, records = hooks) {
      const original = owner[name], own = Object.getOwnPropertyDescriptor(owner, name);
      if (typeof original !== 'function' || (own && (!('value' in own) || (!own.configurable && !own.writable)))) throw new Error('Unsupported native method: ' + name);
      const wrapper = function (...args) {
        let invoked = false, nativeThrown = false, answer;
        const invoke = () => {
          invoked = true;
          try { answer = original.apply(this, args); return answer; }
          catch (error) {
            nativeThrown = true;
            try { stop('반복 중지: 게임 처리 중 오류가 발생했습니다.'); }
            catch (_) { checked = false; phase = 'stopped'; }
            throw error;
          }
        };
        if (faulted || disposed || !available) return invoke();
        try { return around.call(this, invoke, args); }
        catch (error) {
          if (nativeThrown) throw error;
          featureError(error);
          // Never duplicate native work if post-call bookkeeping failed.
          if (invoked) return answer;
          if (internal) throw error;
          return invoke();
        }
      };
      const installed = own ? {...own, value: wrapper} : {configurable: true, enumerable: false, writable: true, value: wrapper};
      Object.defineProperty(owner, name, installed);
      records.push({owner, name, own, wrapper, installed});
    }
    function destroyUI() {
      for (const control of [toggle, prepareToggle, middleToggle, stopControl]) if (control) {
        control.node.off('click', control.callback);
        if (valid(control.node)) control.node.destroy();
      }
      if (reasonNode && valid(reasonNode)) reasonNode.destroy();
      toggle = prepareToggle = middleToggle = stopControl = reasonNode = reasonLabel = null;
      lastPaint = '';
    }
    function unbind() {
      destroyUI();
      restore(hooks);
      hooks = [];
      homeActions.clear();
      binding = null;
      snapshot = null;
      menuEligible = false;
    }
    function component(cc, node, name) {
      const value = node?.getComponent?.(name);
      return value && value.node === node && cc.js?.getClassName?.(value) === name ? value : null;
    }
    function discover() {
      const cc = getEngine?.(), scene = cc?.director?.getScene?.();
      if (!scene || typeof cc.Node !== 'function' || !cc.Button || !cc.Graphics || !cc.Label || !cc.Color) return null;
      const managers = child(scene, 'Managers');
      const gmNode = child(managers, 'GameManager'), endNode = child(managers, 'GMaddComponents'), battleNode = child(managers, 'BattleManager');
      const gm = component(cc, gmNode, 'GameManager'), stage = component(cc, gmNode, 'StageSelectGamen');
      const info = component(cc, gmNode, 'InfoGamen'), end = component(cc, endNode, 'ChapterEnd');
      const result = component(cc, battleNode, 'ResultGamen');
      if (!gm || !stage || !info || !end || !result || gm.stageSelectGamen !== stage || gm.chapterEnd !== end || gm.infoGamen !== info || gm.battle?.result !== result) return null;
      if ([stage, info, end, result].some(value => value.gm !== gm) || stage.GV !== gm.GV || end.GV !== gm.GV || result.GV !== gm.GV) return null;
      if (gm.battleNode !== battleNode || gm.battle.node !== battleNode || result.battle !== gm.battle || result.battlePlay !== gm.battle.battlePlay) return null;
      const requireNative = globalThis.__require || globalThis.window?.__require;
      if (typeof requireNative !== 'function') return null;
      const enums = requireNative('Enums');
      const modes = enums?.Gamen, names = ['HOME', 'CHAPTER', 'TEAM_CHAPTER', 'CHAPTER_END', 'BATTLE'];
      if (!modes || names.some(name => !Number.isInteger(modes[name])) || new Set(names.map(name => modes[name])).size !== names.length) return null;
      if (!enums.Chapter || !Number.isInteger(enums.Chapter.BATTLE) || !Number.isInteger(enums.Chapter.BOSSBATTLE)) return null;
      const objects = {stage, end, result, info};
      if (Object.keys(REQUIRED).some(key => REQUIRED[key].some(name => typeof objects[key][name] !== 'function'))) return null;
      const canvas = gm.CanvasNode;
      if (!canvas || !end.decision || !end.homeBtn || !end.stageBtn || !end.decisionBar || !end.decisionBarParent || typeof end.node.stopAction !== 'function' || typeof end.node.runAction !== 'function') return null;
      const middleBase = child(result.decision, 'base');
      if (!middleBase || middleBase.width < 180 || !valid(result.decision)) return null;
      if (!gm.GV?.stat || !gm.GV?.play || !gm.master?.chapter || !gm.master?.chaPos || !gm.changeGamen || typeof gm.changeGamen.Change !== 'function') return null;
      return {cc, scene, gm, stage, info, end, result, enums, modes, canvas, middleBase, requireNative};
    }
    function sameBinding(next) {
      return binding && next && ['cc', 'scene', 'gm', 'stage', 'end', 'result', 'info', 'canvas', 'middleBase', 'enums'].every(key => binding[key] === next[key]);
    }
    function chapter(id) {
      const master = binding.gm.master;
      return master.chapter[master.chaPos[id]?.master];
    }
    function capture() {
      const {gm, stage, enums} = binding, play = gm.GV.play, row = chapter(stage.pushedChapterID);
      const slots = play.team?.[play.selectedTeamNo];
      if (!row || row.id !== stage.pushedChapterID || !Number.isInteger(stage.selectedChapterGroupID) || !Number.isInteger(play.selectedTeamNo) || !Array.isArray(slots) || slots.length < 6 || slots.some(id => !Number.isInteger(id))) return null;
      if (stage.enseiChapter !== false || stage.battleChapter !== true || ![enums.Chapter.BATTLE, enums.Chapter.BOSSBATTLE, enums.Chapter.STORY].includes(row.type) || !Number.isInteger(row.map) || row.map < 0) return null;
      return Object.freeze({chapterID: row.id, groupID: stage.selectedChapterGroupID, teamNo: play.selectedTeamNo, slots: Object.freeze(slots.slice())});
    }
    function preparing() {
      const {gm, stage, modes} = binding, row = chapter(stage.pushedChapterID);
      return gm.GV.stat.gamenName === modes.TEAM_CHAPTER && stage.battleChapter === true
        && stage.enseiChapter === false && stage.syutsujin === false && row?.map >= 0 && row.file === '';
    }
    function sameTeam() {
      if (!snapshot) return false;
      const play = binding.gm.GV.play, slots = play.team?.[snapshot.teamNo];
      return play.selectedTeamNo === snapshot.teamNo && Array.isArray(slots) && slots.length === snapshot.slots.length && slots.every((id, index) => id === snapshot.slots[index]);
    }
    function coherent() {
      return snapshot && sameTeam() && binding.stage.pushedChapterID === snapshot.chapterID && binding.stage.selectedChapterGroupID === snapshot.groupID;
    }
    function modal() {
      const stat = binding.gm.GV.stat;
      return INPUT.some(key => stat[key] === true);
    }
    function busy() {
      const {gm} = binding;
      return BUSY.some(key => gm.GV.stat[key] === true)
        || gm.serverFunctions?.responseWaiting === true || gm.save?.serverSaveWait === true
        || gm.save?.changeGamenWaiting === true;
    }
    function active(node) {
      return node?.active === true && node.activeInHierarchy !== false;
    }
    function cancelHomeActions() {
      for (const action of homeActions) binding.end.node.stopAction(action);
      homeActions.clear();
    }
    function nativeCall(owner, name, ...args) {
      internal++;
      try { return owner[name](...args); }
      finally { internal--; }
    }
    function newRun(value) {
      snapshot = value;
      serial++;
      missionSerial = serverSerial = readySerial = approvedSerial = menuSerial = -1;
      menuEligible = false;
      if (checked) state('starting', 60000);
    }
    function acceptMenu() {
      const {stage, result} = binding;
      if (!snapshot && !checked) bootstrap();
      if (!snapshot || !coherent() || missionSerial !== serial || (checked && approvedSerial !== serial)) {
        menuEligible = false;
        if (checked) stop('반복 중지: 새 임무 성공 결과를 확인할 수 없습니다.');
        return;
      }
      if (result.battlePlay?.evacuate === true) {
        menuEligible = false;
        if (checked) stop('반복 중지: 퇴각한 전투는 반복하지 않습니다.');
        return;
      }
      if (stage.pushedChapterID !== snapshot.chapterID) return;
      menuEligible = true;
      if (menuSerial !== serial) {
        menuSerial = serial;
        if (checked) completed++;
      }
      if (checked) { due = time() + 1000; state('menu', 30000); }
      paint();
    }
    function install() {
      const {gm, stage, end, result, info} = binding;
      wrap(stage, 'StartChapter', function (invoke) {
        const value = capture();
        if (checked && (!internal || !value || !coherent())) stop('반복 중지: 임무 또는 부대가 변경되었습니다.');
        newRun(value);
        return invoke();
      });
      for (const name of ['DirectSet', 'ChapterBtnPushPrepare']) wrap(stage, name, function (invoke) {
        if (checked && !internal) stop('반복 중지: 직접 임무를 선택했습니다.');
        return invoke();
      });
      wrap(stage, 'SyutsujinBtnPush', function (invoke) {
        if (!checked || internal) return invoke();
        if (phase === 'starting' && coherent() && stage.syutsujin === true) return invoke();
        if (phase !== 'prepared' || !coherent()) {
          stop('반복 중지: 직접 출진 또는 부대 변경을 확인했습니다.');
          return invoke();
        }
        const previous = serial;
        internal++;
        try {
          const answer = invoke();
          if (checked && serial === previous) stop('반복 중지: 게임이 출진을 허용하지 않았습니다.');
          return answer;
        } finally { internal--; }
      });
      wrap(end, 'CheckChapterClear', function (invoke, args) {
        const answer = invoke();
        if (args[1] === true && snapshot && args[0] === snapshot.chapterID) {
          if (result.mission === true && result.battlePlay?.evacuate !== true) missionSerial = serial;
          else { missionSerial = -1; if (checked) stop('반복 중지: 임무 실패 또는 퇴각입니다.'); }
        }
        return answer;
      });
      wrap(result, 'BattleResultSuccess', function (invoke) {
        if (snapshot) serverSerial = serial;
        return invoke();
      });
      wrap(result, 'ShowBackBtn', function (invoke) {
        const answer = invoke();
        if (snapshot && serverSerial === serial && active(result.finalResult) && active(result.homeBtn) && result.enseiChapter === false) readySerial = serial;
        return answer;
      });
      wrap(result, 'TouchHomeBtn', function (invoke) {
        if (checked && approvedSerial === serial) return undefined;
        return invoke();
      });
      wrap(result, 'Approval', function (invoke) {
        if (checked && approvedSerial === serial) return undefined;
        if (snapshot && active(result.finalResult) && active(result.homeBtn)) {
          if (checked && (serverSerial !== serial || readySerial !== serial || missionSerial !== serial || result.mission !== true)) stop('반복 중지: 새 결과 보고서를 확인할 수 없습니다.');
          approvedSerial = serial;
          if (checked) state('approval', 60000);
        }
        return invoke();
      });
      wrap(result, 'SetResultState', function (invoke) {
        const answer = invoke();
        if (checked && Number.isFinite(result.senkaKunitamaNum) && result.senkaKunitamaNum <= 0) stop('반복 중지: 전투에서 패배했습니다.');
        return answer;
      });
      wrap(end, 'ShowDecision', function (invoke) {
        const answer = invoke();
        if (finishing) finishDecision = true;
        acceptMenu();
        return answer;
      });
      wrap(end, 'Finish', function (invoke) {
        // Finish is synchronous. Capture only its post-ShowDecision 15-second home action.
        const records = [], wasFinishing = finishing, previousDecision = finishDecision;
        finishing++;
        finishDecision = false;
        try {
          wrap(end.node, 'runAction', function (run, args) {
            const action = args[0], isHome = finishDecision && typeof action?.getDuration === 'function' && Math.abs(action.getDuration() - 15) < 0.001;
            const answer = run();
            if (isHome) homeActions.add(answer || action);
            return answer;
          }, records);
          return invoke();
        } finally {
          restore(records);
          finishing = wasFinishing;
          finishDecision = previousDecision;
        }
      });
      wrap(end, 'HideDecision', function (invoke) {
        // Native manual card callbacks disarm first; this blocks only a timed escape while armed.
        if (checked) return undefined;
        menuEligible = false;
        paint();
        return invoke();
      });
      for (const name of ['TouchHomeBtn', 'TouchStageBtn']) wrap(end, name, function (invoke) {
        if (checked) stop(name === 'TouchHomeBtn' ? '반복 중지: 장원으로 돌아갑니다.' : '반복 중지: 직접 다음 임무를 선택했습니다.');
        menuEligible = false;
        paint();
        return invoke();
      });
      for (const name of REQUIRED.info) wrap(info, name, function (invoke) {
        if (checked) stop(name === 'Error' ? '반복 중지: 게임 오류를 확인하세요.' : '반복 중지: 게임 알림을 확인하세요.');
        return invoke();
      });
      wrap(gm.changeGamen, 'Change', function (invoke, args) {
        if (checked) {
          const target = args[0], m = binding.modes;
          const expected = internal && ((phase === 'list' && target === m.CHAPTER) || (phase === 'team' && target === m.TEAM_CHAPTER) || (phase === 'starting' && target === m.BATTLE));
          const nativeResult = ['starting', 'battle', 'report', 'approval'].includes(phase) && [m.BATTLE, m.CHAPTER_END].includes(target);
          if (!expected && !nativeResult) stop('반복 중지: 다른 화면으로 이동했습니다.');
        }
        return invoke();
      });
    }
    function makeControl(name, parent, width, callback) {
      const {cc} = binding, node = new cc.Node(name);
      node.setContentSize(width, 64);
      parent.addChild(node);
      const graphics = node.addComponent(cc.Graphics), button = node.addComponent(cc.Button);
      button.interactable = true;
      if (cc.Button.Transition) button.transition = cc.Button.Transition.NONE;
      const text = new cc.Node(name + '-label');
      text.setContentSize(width - 16, 58);
      node.addChild(text);
      const label = text.addComponent(cc.Label);
      label.fontSize = 23;
      label.lineHeight = 28;
      if (cc.Label.HorizontalAlign) label.horizontalAlign = cc.Label.HorizontalAlign.CENTER;
      if (cc.Label.VerticalAlign) label.verticalAlign = cc.Label.VerticalAlign.CENTER;
      const onClick = () => {
        try { callback(); }
        catch (error) { featureError(error); }
      };
      node.on('click', onClick);
      return {node, label, graphics, callback: onClick, width};
    }
    function midway() {
      const {gm, result, stage, modes} = binding, row = chapter(stage.pushedChapterID);
      return gm.GV.stat.gamenName === modes.BATTLE && active(result.decision) && !active(result.finalResult)
        && row?.file === '' && gm.GV.play.playingChapterID === row.id;
    }
    function toggleRepeat(source) {
      const {end, gm, stage} = binding, beforeBattle = source === 'prepare', inBattle = source === 'middle';
      if (!available || faulted || disposed || hidden()) return;
      if (checked) { stop('반복 중지: 체크를 해제했습니다.'); return; }
      if (beforeBattle ? !preparing() : inBattle ? !midway() : !active(end.decision) || !end.showDecision) return;
      if (modal() || busy()) { stop('반복 중지: 화면 상태를 확인하세요.'); return; }
      if (beforeBattle || inBattle) {
        const value = capture();
        if (!value) { stop('반복 중지: 임무와 부대를 확인하세요.'); return; }
        if (inBattle && (gm.GV.play.playingChapterID !== value.chapterID || stage.lastPlayedChapterID !== value.chapterID || gm.battle.mapNo !== chapter(value.chapterID).map)) {
          stop('반복 중지: 현재 진행 중인 임무를 확인할 수 없습니다.');
          return;
        }
        newRun(value);
      } else if (!menuEligible || !coherent()) {
        stop('반복 중지: 임무와 부대를 확인하세요.');
        return;
      }
      const row = chapter(snapshot.chapterID);
      if (!row || row.file !== '') { stop('반복 중지: 대화 입력이 필요한 임무입니다.'); return; }
      checked = true;
      completed = 0;
      reason = '';
      reasonUntil = 0;
      if (beforeBattle) state('prepared');
      else if (inBattle) state('battle', 30 * 60 * 1000);
      else { due = time() + 1000; state('menu', 30000); }
    }
    function makeUI() {
      const {cc, end, result, canvas} = binding;
      toggle = makeControl('tamacolle-kor-repeat-toggle', end.decision, 450, () => toggleRepeat('end'));
      prepareToggle = makeControl('tamacolle-kor-repeat-prepare', canvas, 156, () => toggleRepeat('prepare'));
      middleToggle = makeControl('tamacolle-kor-repeat-intermediate', result.decision, 156, () => toggleRepeat('middle'));
      for (const control of [prepareToggle, middleToggle]) {
        control.label.fontSize = 18;
        control.label.node.setContentSize(100, 58);
        control.label.node.setPosition(20, 0);
        control.node.zIndex = 32760;
      }
      stopControl = makeControl('tamacolle-kor-repeat-stop', canvas, 240, () => {
        if (checked) stop('반복 중지: 중지 버튼을 눌렀습니다.');
      });
      toggle.node.active = prepareToggle.node.active = middleToggle.node.active = stopControl.node.active = false;
      reasonNode = new cc.Node('tamacolle-kor-repeat-reason');
      reasonNode.setContentSize(460, 64);
      canvas.addChild(reasonNode);
      reasonLabel = reasonNode.addComponent(cc.Label);
      reasonLabel.fontSize = 18;
      reasonLabel.lineHeight = 22;
      if (cc.Label.Overflow) reasonLabel.overflow = cc.Label.Overflow.CLAMP;
      if (cc.Label.HorizontalAlign) reasonLabel.horizontalAlign = cc.Label.HorizontalAlign.RIGHT;
      if (cc.Label.VerticalAlign) reasonLabel.verticalAlign = cc.Label.VerticalAlign.CENTER;
      reasonNode.zIndex = stopControl.node.zIndex = 32760;
      toggle.node.zIndex = 32760;
      layout();
      paint();
    }
    function layout() {
      const {end, canvas, middleBase} = binding;
      const bottom = node => {
        const local = {x: 0, y: -(node.height || 0) * (node.anchorY ?? 0.5)};
        if (typeof node.convertToWorldSpaceAR === 'function' && typeof end.decision.convertToNodeSpaceAR === 'function') return end.decision.convertToNodeSpaceAR(node.convertToWorldSpaceAR(local)).y;
        if (node.parent === end.decision) return node.y + local.y;
        throw new Error('Unsupported decision geometry');
      };
      const home = end.homeBtn, stage = end.stageBtn;
      const x = (home.x + stage.x) / 2;
      const y = Math.min(bottom(home), bottom(stage), bottom(end.decisionBarParent)) - 40;
      toggle.node.setPosition(x, y);
      middleToggle.node.setPosition(middleBase.x - middleBase.width * (middleBase.anchorX ?? 0.5) + 90,
        middleBase.y + middleBase.height * (1 - (middleBase.anchorY ?? 0.5)) + 36);
      const width = canvas.width, height = canvas.height;
      if (!(width >= 450 && height >= 300)) throw new Error('Unsupported canvas geometry');
      const right = width * (1 - (canvas.anchorX ?? 0.5)), top = height * (1 - (canvas.anchorY ?? 0.5));
      prepareToggle.node.setPosition(-width * (canvas.anchorX ?? 0.5) + width * 0.293, top - 32);
      stopControl.node.setPosition(right - 132, top - 42);
      reasonNode.setPosition(right - 242, top - 112);
    }
    function draw(control, text, selected) {
      const {cc} = binding, g = control.graphics;
      control.label.string = text;
      g.clear();
      g.fillColor = new cc.Color(selected ? 36 : 24, selected ? 91 : 36, selected ? 63 : 46, 245);
      g.rect(-control.width / 2, -32, control.width, 64);
      g.fill();
      g.lineWidth = 2;
      g.strokeColor = new cc.Color(220, 230, 220, 255);
      g.rect(-control.width / 2 + 1, -31, control.width - 2, 62);
      g.stroke();
      if (control === toggle || control === prepareToggle || control === middleToggle) {
        const left = -control.width / 2 + (control === toggle ? 20 : 12);
        g.rect(left, -16, 32, 32);
        g.stroke();
        if (selected) {
          g.lineWidth = 4;
          g.moveTo(left + 6, 0);
          g.lineTo(left + 13, -9);
          g.lineTo(left + 27, 12);
          g.stroke();
        }
      }
    }
    function paint() {
      if (!binding || !toggle || !stopControl) return;
      toggle.node.active = available && !faulted && menuEligible && binding.end.showDecision === true && active(binding.end.decision);
      prepareToggle.node.active = available && !faulted && preparing();
      middleToggle.node.active = available && !faulted && midway();
      stopControl.node.active = checked && !prepareToggle.node.active;
      reasonNode.active = available && !!reason && now() < reasonUntil;
      const key = [checked, completed, reason].join('|');
      if (key === lastPaint) return;
      lastPaint = key;
      draw(toggle, '방금 전투 반복', checked);
      draw(prepareToggle, '전투 반복', checked);
      draw(middleToggle, '전투 반복', checked);
      draw(stopControl, '반복 중지 · ' + completed + '회', true);
      reasonLabel.string = reason;
    }
    function bootstrap() {
      const {end, stage, result, gm, modes} = binding;
      if (gm.GV.stat.gamenName !== modes.CHAPTER_END || end.showDecision !== true || !active(end.decision) || result.battlePlay?.evacuate === true) return;
      const value = capture();
      if (!value) return;
      const directProof = end.chapterID === value.chapterID && result.mission === true;
      const row = chapter(value.chapterID);
      // Finish.Reset clears mission, and ServerAccessEnd can clear chapterID.
      // The native pure mission predicate plus the last played map/report is the
      // only permitted bootstrap in that case; never rerun CheckChapterClear.
      const retainedProof = stage.lastPlayedChapterID === value.chapterID && row.map === gm.battle.mapNo
        && typeof result.finalResultServerData === 'string' && result.finalResultServerData.length > 0
        && typeof end.CheckMissionClear === 'function' && end.CheckMissionClear(row.clearType) === true;
      if (!directProof && !retainedProof) return;
      newRun(value);
      missionSerial = serial;
      menuSerial = serial;
      menuEligible = true;
      paint();
    }
    function advance() {
      const {gm, stage, result, end, modes} = binding, mode = gm.GV.stat.gamenName;
      if (!sameTeam()) { stop('반복 중지: 부대 편성이 변경되었습니다.'); return; }
      if (modal()) { stop('반복 중지: 대화 또는 알림을 직접 확인하세요.'); return; }
      if (deadline && time() > deadline) { stop('반복 중지: 게임 응답 대기 시간이 초과되었습니다.'); return; }
      if (phase !== 'list' && !coherent()) { stop('반복 중지: 임무가 변경되었습니다.'); return; }
      if (phase === 'prepared') {
        if (mode !== modes.TEAM_CHAPTER) stop('반복 중지: 부대 선택 화면을 벗어났습니다.');
        return;
      }
      if (result.battlePlay?.evacuate === true && (serverSerial === serial || missionSerial === serial || menuEligible)) { stop('반복 중지: 퇴각했습니다.'); return; }
      if (phase === 'menu') {
        if (mode !== modes.CHAPTER_END || !end.showDecision || !active(end.decision)) { stop('반복 중지: 전투 종료 화면을 벗어났습니다.'); return; }
        if (busy() || time() < due) return;
        const row = chapter(snapshot.chapterID);
        if (!row || (typeof row.file === 'string' && row.file !== '')) { stop('반복 중지: 대화 입력이 필요한 임무입니다.'); return; }
        cancelHomeActions();
        // The bar belongs exclusively to ChapterEnd, unlike its shared manager node.
        end.decisionBar.stopAllActions();
        // Never call HideDecision(false): its delayed GoStage selects the NEXT mission.
        end.showDecision = false;
        end.decision.active = false;
        end.decisionBarParent.active = false;
        state('list', 45000);
        nativeCall(stage, 'DirectSet', snapshot.groupID, snapshot.chapterID);
      } else if (phase === 'list') {
        if (![modes.CHAPTER_END, modes.CHAPTER].includes(mode)) { stop('반복 중지: 임무 목록을 벗어났습니다.'); return; }
        if (mode !== modes.CHAPTER || busy()) return;
        if (stage.selectedChapterGroupID !== snapshot.groupID) { stop('반복 중지: 임무 그룹이 변경되었습니다.'); return; }
        if (!Array.isArray(stage.chapterList)) { stop('반복 중지: 임무 목록 API가 변경되었습니다.'); return; }
        const index = stage.chapterList.findIndex(value => value?.id === snapshot.chapterID);
        if (index < 0) { stop('반복 중지: 방금 임무를 목록에서 찾을 수 없습니다.'); return; }
        state('team', 45000);
        nativeCall(stage, 'ChapterBtnPushPrepare', index);
      } else if (phase === 'team') {
        if (![modes.CHAPTER, modes.TEAM_CHAPTER].includes(mode)) { stop('반복 중지: 부대 준비 화면을 벗어났습니다.'); return; }
        if (mode !== modes.TEAM_CHAPTER || busy()) return;
        if (!coherent() || stage.battleChapter !== true || stage.enseiChapter !== false || stage.syutsujin !== false) { stop('반복 중지: 같은 전투의 출진 준비를 확인할 수 없습니다.'); return; }
        const previous = serial;
        state('starting', 60000);
        nativeCall(stage, 'SyutsujinBtnPush');
        if (checked && serial === previous) stop('반복 중지: 게임이 출진을 허용하지 않았습니다.');
      } else if (phase === 'starting') {
        if (mode === modes.BATTLE) state('battle', 30 * 60 * 1000);
        else if (![modes.TEAM_CHAPTER, modes.CHAPTER].includes(mode)) stop('반복 중지: 전투 시작을 확인할 수 없습니다.');
      } else if (phase === 'battle' || phase === 'report') {
        if (mode !== modes.BATTLE) { stop('반복 중지: 전투 화면을 벗어났습니다.'); return; }
        if (serverSerial !== serial || readySerial !== serial || !active(result.finalResult) || !active(result.homeBtn) || result.enseiChapter !== false || busy()) return;
        if (missionSerial !== serial || result.mission !== true) { stop('반복 중지: 임무 성공을 확인할 수 없습니다.'); return; }
        if (approvedSerial === serial) return;
        state('approval', 60000);
        nativeCall(result, 'TouchHomeBtn');
      } else if (phase === 'approval') {
        if (![modes.BATTLE, modes.CHAPTER_END].includes(mode)) stop('반복 중지: 결과 승인 화면을 벗어났습니다.');
      }
      paint();
    }
    function tick() {
      if (disposed || faulted || !available) return;
      time();
      if (hidden()) return;
      try {
        const next = discover();
        if (!sameBinding(next)) {
          if (checked) stop('반복 중지: 게임 화면 또는 API가 변경되었습니다.');
          if (binding) unbind();
          if (!next) return;
          binding = next;
          try { install(); makeUI(); bootstrap(); }
          catch (error) { unbind(); throw error; }
        }
        if (hooks.some(h => !owns(h))) {
          stop('반복 중지: 다른 기능이 게임 API를 변경했습니다.');
          unbind();
          available = false;
          return;
        }
        layout();
        if (checked) advance();
        else paint();
      } catch (error) { featureError(error); }
    }
    function configure(enabled) {
      if (disposed) return;
      const next = enabled === true;
      if (available === next) return;
      available = next;
      if (available) faulted = false;
      if (!available) {
        try { stop('반복 중지: 번역 확장을 껐습니다.'); }
        catch (error) { featureError(error); }
        try { unbind(); }
        catch (error) { featureError(error); }
      }
    }
    function onHidden() { time(); }
    function onPageHide() { dispose(); }
    function dispose() {
      if (disposed) return;
      disposed = true;
      available = false;
      try { stop('반복 중지: 확장 기능이 종료되었습니다.'); }
      catch (error) { featureError(error); }
      try { unbind(); }
      catch (error) { featureError(error); }
      finally {
        doc?.removeEventListener?.('visibilitychange', onHidden);
        globalThis.removeEventListener?.('pagehide', onPageHide);
      }
    }
    doc?.addEventListener?.('visibilitychange', onHidden);
    globalThis.addEventListener?.('pagehide', onPageHide);
    return Object.freeze({configure, tick, dispose, status: () => Object.freeze({checked, reason, completed, phase})});
  }
  Object.defineProperty(globalThis, KEY, {value: Object.freeze({create}), configurable: true});
})();
