(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory();
    } else {
        root.TaskSandbox = factory();
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    "use strict";

    function copy(value) {
        return JSON.parse(JSON.stringify(value));
    }

    function object(value) {
        return value !== null && typeof value === "object" && !Array.isArray(value);
    }

    function ensure(condition, message) {
        if (!condition) throw new TypeError("场景无效：" + message);
    }

    function text(value) {
        return typeof value === "string" && value.trim().length > 0;
    }

    function finite(value) {
        return typeof value === "number" && Number.isFinite(value);
    }

    function positiveInteger(value) {
        return Number.isSafeInteger(value) && value > 0;
    }

    function distance(a, b) {
        return Math.hypot(a.x - b.x, a.y - b.y);
    }

    function inside(point, area) {
        return distance(point, area) <= area.radius;
    }

    function traverses(from, to, area) {
        var dx = to.x - from.x;
        var dy = to.y - from.y;
        var lengthSquared = dx * dx + dy * dy;
        if (!lengthSquared) return inside(from, area);
        var t = Math.max(0, Math.min(1,
            ((area.x - from.x) * dx + (area.y - from.y) * dy) / lengthSquared));
        return inside({ x: from.x + t * dx, y: from.y + t * dy }, area);
    }

    function validate(scene) {
        ensure(object(scene), "根节点必须是对象");
        ensure(scene.schemaVersion === 1, "schemaVersion 必须为 1");
        ensure(text(scene.id) && text(scene.title), "id 和 title 必须是非空字符串");
        ensure(object(scene.provenance) && text(scene.provenance.kind) && text(scene.provenance.notice),
            "必须说明 provenance.kind 和 provenance.notice");
        function keys(value, allowed, label) {
            ensure(object(value), label + " 必须是对象");
            Object.keys(value).forEach(function (key) {
                ensure(allowed.split(" ").includes(key), label + " 不支持字段：" + key);
            });
        }
        keys(scene, "schemaVersion id title description provenance bounds player areas combat enemies chest quest rules", "场景");
        keys(scene.provenance, "kind notice source version mapLayer coordinateSystem", "来源");
        ["source", "version", "mapLayer", "coordinateSystem"].forEach(function (key) {
            ensure(text(scene.provenance[key]), "provenance." + key + " 必须声明");
        });
        ensure(scene.provenance.coordinateSystem === "sandbox-cartesian-v1", "坐标系尚未适配，须先转换为 sandbox-cartesian-v1");
        keys(scene.bounds, "minX maxX minY maxY", "边界");
        keys(scene.player, "spawn maxHp", "角色");
        keys(scene.player.spawn, "x y", "出生点");
        keys(scene.combat, "battleAreaId groupId attackDamage attackRange counterDamage", "战斗");
        keys(scene.chest, "id name x y interactionRange unlockGroupId reward", "宝箱");
        keys(scene.chest.reward, "tokens", "奖励");
        keys(scene.quest, "id title steps", "任务");
        keys(scene.rules, "movement movementNotice combatNotice rewardNotice", "规则");
        var bounds = scene.bounds;
        ensure(object(bounds) && [bounds.minX, bounds.maxX, bounds.minY, bounds.maxY].every(finite),
            "bounds 必须包含有限数值");
        ensure(bounds.minX < bounds.maxX && bounds.minY < bounds.maxY, "bounds 范围无效");
        ensure(finite(bounds.maxX - bounds.minX) && finite(bounds.maxY - bounds.minY), "bounds 范围过大");

        var ids = new Set();
        function id(value, label) {
            ensure(text(value), label + " id 必须是非空字符串");
            ensure(!ids.has(value), "重复 id：" + value);
            ids.add(value);
        }
        function point(value, label) {
            ensure(object(value) && finite(value.x) && finite(value.y), label + " 坐标必须是有限数值");
            ensure(value.x >= bounds.minX && value.x <= bounds.maxX &&
                value.y >= bounds.minY && value.y <= bounds.maxY, label + " 坐标超出 bounds");
        }
        id(scene.id, "场景");
        ensure(object(scene.player) && positiveInteger(scene.player.maxHp), "player.maxHp 必须为正整数");
        point(scene.player.spawn, "出生点");
        ensure(Array.isArray(scene.areas) && scene.areas.length > 0, "areas 必须是非空数组");
        var areas = new Set();
        scene.areas.forEach(function (area) {
            ensure(object(area), "area 必须是对象");
            keys(area, "id name shape x y radius", "区域");
            id(area.id, "区域");
            ensure(text(area.name) && area.shape === "circle", "区域必须有 name，且 shape 为 circle");
            point(area, "区域");
            ensure(finite(area.radius) && area.radius > 0, "区域 radius 必须为正有限数值");
            areas.add(area.id);
        });
        ensure(Array.isArray(scene.enemies) && scene.enemies.length > 0, "enemies 必须是非空数组");
        var groups = new Set();
        scene.enemies.forEach(function (enemy) {
            ensure(object(enemy), "enemy 必须是对象");
            keys(enemy, "id name groupId maxHp x y", "敌人");
            id(enemy.id, "敌人");
            ensure(text(enemy.name) && text(enemy.groupId), "敌人必须有 name 和 groupId");
            ensure(positiveInteger(enemy.maxHp), "敌人 maxHp 必须为正整数");
            point(enemy, "敌人");
            groups.add(enemy.groupId);
        });
        var combat = scene.combat;
        ensure(object(combat), "combat 必须是对象");
        ensure(areas.has(combat.battleAreaId), "combat.battleAreaId 引用了不存在的区域");
        ensure(groups.has(combat.groupId), "combat.groupId 引用了不存在的敌人组");
        ensure(positiveInteger(combat.attackDamage), "combat.attackDamage 必须为正整数");
        ensure(finite(combat.attackRange) && combat.attackRange > 0, "combat.attackRange 必须为正有限数值");
        ensure(Number.isSafeInteger(combat.counterDamage) && combat.counterDamage >= 0,
            "combat.counterDamage 必须为非负整数");
        var chest = scene.chest;
        ensure(object(chest), "chest 必须是对象");
        id(chest.id, "宝箱");
        ensure(text(chest.name), "宝箱 name 必须是非空字符串");
        point(chest, "宝箱");
        ensure(finite(chest.interactionRange) && chest.interactionRange > 0,
            "宝箱 interactionRange 必须为正有限数值");
        ensure(groups.has(chest.unlockGroupId), "chest.unlockGroupId 引用了不存在的敌人组");
        ensure(object(chest.reward) && Number.isSafeInteger(chest.reward.tokens) && chest.reward.tokens >= 0,
            "宝箱 reward.tokens 必须为非负整数");
        ensure(object(scene.quest) && text(scene.quest.title), "quest 必须包含 title");
        id(scene.quest.id, "任务");
        ensure(Array.isArray(scene.quest.steps) && scene.quest.steps.length > 0, "quest.steps 必须是非空数组");
        scene.quest.steps.forEach(function (step) {
            ensure(object(step), "任务步骤必须是对象");
            keys(step, "id title condition", "任务步骤");
            id(step.id, "任务步骤");
            ensure(text(step.title) && object(step.condition), "任务步骤必须有 title 和 condition");
            var condition = step.condition;
            keys(condition, condition.type === "enter-area" ? "type areaId" : condition.type === "defeat-group" ? "type groupId" : "type chestId", "任务条件");
            if (condition.type === "enter-area") {
                ensure(areas.has(condition.areaId), "enter-area 引用了不存在的区域");
            } else if (condition.type === "defeat-group") {
                ensure(groups.has(condition.groupId), "defeat-group 引用了不存在的敌人组");
            } else if (condition.type === "open-chest") {
                ensure(condition.chestId === chest.id, "open-chest 引用了不存在的宝箱");
            } else {
                ensure(false, "未知任务条件：" + String(condition.type));
            }
        });
        ensure(object(scene.rules) && scene.rules.movement === "straight-line",
            "rules.movement 仅支持 straight-line");
    }

    class World {
        constructor(scene) {
            validate(scene);
            this._scene = copy(scene);
            this._reset("演示环境已就绪；所有坐标和规则均为合成示例。");
        }

        _event(type, message) {
            this._state.events.push({ tick: this._state.tick, type: type, message: message });
        }

        _reset(message) {
            var scene = this._scene;
            this._enteredAreas = new Set();
            this._state = {
                scene: copy(scene),
                player: { x: scene.player.spawn.x, y: scene.player.spawn.y,
                    hp: scene.player.maxHp, maxHp: scene.player.maxHp },
                enemies: scene.enemies.map(function (enemy) {
                    return { id: enemy.id, name: enemy.name, x: enemy.x, y: enemy.y,
                        hp: enemy.maxHp, maxHp: enemy.maxHp, groupId: enemy.groupId };
                }),
                chest: { id: scene.chest.id, name: scene.chest.name, x: scene.chest.x, y: scene.chest.y,
                    state: "locked", reward: copy(scene.chest.reward) },
                battle: { active: false, cleared: false },
                quest: { steps: scene.quest.steps.map(function (step, index) {
                    return { id: step.id, title: step.title, status: index === 0 ? "active" : "pending" };
                }), complete: false },
                inventory: { tokens: 0 },
                events: [],
                tick: 0
            };
            this._event("reset", message);
            this._scene.areas.forEach((area) => {
                if (inside(this._state.player, area)) this._enteredAreas.add(area.id);
            });
            this._refresh();
        }

        snapshot() {
            return copy(this._state);
        }

        _groupDefeated(groupId) {
            return this._state.enemies.filter(function (enemy) { return enemy.groupId === groupId; })
                .every(function (enemy) { return enemy.hp === 0; });
        }

        _battleArea() {
            return this._scene.areas.find((area) => area.id === this._scene.combat.battleAreaId);
        }

        _conditionMet(condition) {
            if (condition.type === "enter-area") return this._enteredAreas.has(condition.areaId);
            if (condition.type === "defeat-group") return this._groupDefeated(condition.groupId);
            return this._state.chest.state === "opened";
        }

        _refresh() {
            var state = this._state;
            var battle = state.battle;
            var wasActive = battle.active;
            var wasCleared = battle.cleared;
            battle.cleared = this._groupDefeated(this._scene.combat.groupId);
            battle.active = state.player.hp > 0 && !battle.cleared && inside(state.player, this._battleArea());
            if (!wasCleared && battle.cleared) this._event("battle-cleared", "营地守卫已全部击败。");
            if (!wasActive && battle.active) this._event("battle-start", "进入营地战斗范围。");
            if (wasActive && !battle.active && !battle.cleared && state.player.hp > 0) {
                this._event("battle-exit", "已离开营地，战斗暂停；守卫生命值保留。");
            }
            if (state.chest.state === "locked" && this._groupDefeated(this._scene.chest.unlockGroupId)) {
                state.chest.state = "available";
                this._event("chest-unlocked", "守卫已清除，营地宝箱解锁。");
            }
            // A lethal counterattack never advances the quest or awards a reward.
            if (state.player.hp === 0) return;
            for (var i = 0; i < state.quest.steps.length; i++) {
                var step = state.quest.steps[i];
                if (step.status === "completed") continue;
                if (!this._conditionMet(this._scene.quest.steps[i].condition)) break;
                step.status = "completed";
                this._event("quest-step", "任务步骤完成：" + step.title);
                if (i + 1 < state.quest.steps.length) state.quest.steps[i + 1].status = "active";
            }
            var complete = state.quest.steps.every(function (step) { return step.status === "completed"; });
            if (complete && !state.quest.complete) this._event("quest-complete", "演示任务已完成。");
            state.quest.complete = complete;
        }

        _result(ok, code, message) {
            this._event(ok ? "action" : "rejected", message);
            return { ok: ok, code: code, message: message };
        }

        dispatch(action) {
            if (object(action) && action.type === "reset") {
                this._reset("环境已重置；任务、敌人和奖励状态已恢复。");
                return { ok: true, code: "RESET", message: "环境已重置。" };
            }
            this._state.tick++;
            if (!object(action) || !text(action.type)) {
                return this._result(false, "INVALID_ACTION", "动作必须是包含 type 的对象。");
            }
            if (!["move", "attack", "interact"].includes(action.type)) {
                return this._result(false, "UNKNOWN_ACTION", "不支持的动作：" + action.type);
            }
            if (this._state.player.hp === 0) {
                return this._result(false, "PLAYER_DEAD", "角色已倒下，请重置环境后继续。");
            }
            if (action.type === "move") return this._move(action);
            if (action.type === "attack") return this._attack(action);
            return this._interact();
        }

        _move(action) {
            var bounds = this._scene.bounds;
            if (!finite(action.x) || !finite(action.y)) {
                return this._result(false, "INVALID_COORDINATES", "移动坐标必须是有限数值。");
            }
            if (action.x < bounds.minX || action.x > bounds.maxX ||
                action.y < bounds.minY || action.y > bounds.maxY) {
                return this._result(false, "OUT_OF_BOUNDS", "移动目标超出场景边界。");
            }
            var from = { x: this._state.player.x, y: this._state.player.y };
            this._state.player.x = action.x;
            this._state.player.y = action.y;
            this._scene.areas.forEach((area) => {
                if (traverses(from, action, area) && !this._enteredAreas.has(area.id)) {
                    this._enteredAreas.add(area.id);
                    this._event("area-entered", "直线路径经过区域：" + area.name);
                }
            });
            this._refresh();
            return this._result(true, "MOVED", "直线移动至 (" + action.x + ", " + action.y + ")。");
        }

        _attack(action) {
            var combat = this._scene.combat;
            if (action.targetId !== undefined && !text(action.targetId)) {
                return this._result(false, "INVALID_TARGET", "targetId 必须是非空字符串。");
            }
            if (!inside(this._state.player, this._battleArea())) {
                return this._result(false, "OUTSIDE_BATTLE_AREA", "请进入营地范围后攻击。");
            }
            var enemy;
            if (action.targetId !== undefined) {
                enemy = this._state.enemies.find(function (item) { return item.id === action.targetId; });
                if (!enemy) return this._result(false, "TARGET_NOT_FOUND", "未找到指定守卫。");
                if (enemy.groupId !== combat.groupId) {
                    return this._result(false, "TARGET_NOT_IN_BATTLE", "目标不属于当前营地守卫组。");
                }
                if (enemy.hp === 0) return this._result(false, "TARGET_DEFEATED", "该守卫已被击败。");
            } else {
                var targets = this._state.enemies.filter(function (item) {
                    return item.groupId === combat.groupId && item.hp > 0;
                });
                if (!targets.length) return this._result(false, "BATTLE_CLEARED", "营地守卫已全部击败。");
                targets.sort((a, b) => distance(a, this._state.player) - distance(b, this._state.player));
                enemy = targets[0];
            }
            if (distance(enemy, this._state.player) > combat.attackRange) {
                return this._result(false, "OUT_OF_RANGE", "守卫不在攻击范围内（" + combat.attackRange + "）。");
            }
            enemy.hp = Math.max(0, enemy.hp - combat.attackDamage);
            this._event("damage", enemy.name + "受到 " + combat.attackDamage + " 点伤害，剩余生命 " + enemy.hp + "。");
            if (enemy.hp === 0) this._event("enemy-defeated", enemy.name + "已被击败。");
            if (!this._groupDefeated(combat.groupId) && combat.counterDamage > 0) {
                this._state.player.hp = Math.max(0, this._state.player.hp - combat.counterDamage);
                this._event("counterattack", "存活守卫反击一次，角色受到 " + combat.counterDamage + " 点伤害。");
                if (this._state.player.hp === 0) this._event("player-defeated", "角色已倒下，后续操作被阻止。");
            }
            this._refresh();
            return this._result(true, "ATTACKED", "已攻击" + enemy.name + "。");
        }

        _interact() {
            var chest = this._state.chest;
            if (chest.state === "opened") return this._result(false, "ALREADY_OPENED", "宝箱已打开，奖励不会重复领取。");
            if (chest.state === "locked") return this._result(false, "CHEST_LOCKED", "宝箱尚未解锁，请先击败全部指定守卫。");
            if (distance(chest, this._state.player) > this._scene.chest.interactionRange) {
                return this._result(false, "OUT_OF_RANGE", "距离宝箱过远，无法交互。");
            }
            // State and reward are updated together; later attempts are rejected above.
            chest.state = "opened";
            this._state.inventory.tokens += chest.reward.tokens;
            this._event("reward", "打开营地宝箱，获得 " + chest.reward.tokens + " 枚演示代币。");
            this._refresh();
            return this._result(true, "CHEST_OPENED", "宝箱已打开，演示奖励已领取。");
        }
    }

    return { World: World };
});
