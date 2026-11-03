"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { World } = require("./world.js");
const scene = JSON.parse(fs.readFileSync(path.join(__dirname, "scenarios", "camp-demo.json"), "utf8"));
const clone = value => JSON.parse(JSON.stringify(value));
let passed = 0;

function test(name, fn) {
    try {
        fn();
        passed++;
        process.stdout.write("PASS " + name + "\n");
    } catch (error) {
        process.stderr.write("FAIL " + name + "\n");
        throw error;
    }
}

function perform(world, action, code) {
    const result = world.dispatch(action);
    assert.equal(result.ok, true, result.message);
    if (code) assert.equal(result.code, code);
    return result;
}

function unchangedFailure(world, action, code) {
    const before = world.snapshot();
    const result = world.dispatch(action);
    const after = world.snapshot();
    assert.equal(result.ok, false);
    assert.equal(result.code, code);
    for (const key of ["player", "enemies", "chest", "battle", "quest", "inventory"]) {
        assert.deepEqual(after[key], before[key], key + " mutated after rejected action");
    }
    assert.equal(after.tick, before.tick + 1);
    assert.equal(after.events.length, before.events.length + 1);
    assert.equal(after.events.at(-1).tick, after.tick);
}

function defeatGuards(world) {
    perform(world, { type: "move", x: 54, y: 44 }, "MOVED");
    perform(world, { type: "attack", targetId: "guard-a" }, "ATTACKED");
    perform(world, { type: "attack", targetId: "guard-a" }, "ATTACKED");
    perform(world, { type: "move", x: 65, y: 55 }, "MOVED");
    perform(world, { type: "attack", targetId: "guard-b" }, "ATTACKED");
    perform(world, { type: "attack", targetId: "guard-b" }, "ATTACKED");
}

test("initial snapshot follows contract and synthetic provenance", () => {
    const state = new World(scene).snapshot();
    assert.deepEqual(Object.keys(state).sort(),
        ["scene", "player", "enemies", "chest", "battle", "quest", "inventory", "events", "tick"].sort());
    assert.deepEqual(state.player, { x: 12, y: 50, hp: 100, maxHp: 100 });
    assert.deepEqual(state.quest.steps.map(s => s.status), ["active", "pending", "pending"]);
    assert.deepEqual(state.battle, { active: false, cleared: false });
    assert.equal(state.chest.state, "locked");
    assert.equal(state.scene.provenance.kind, "synthetic");
    assert.equal(state.tick, 0);
});

test("complete ordered chain unlocks and awards exactly ten tokens", () => {
    const world = new World(scene);
    defeatGuards(world);
    let state = world.snapshot();
    assert.deepEqual(state.battle, { active: false, cleared: true });
    assert.deepEqual(state.quest.steps.map(s => s.status), ["completed", "completed", "active"]);
    assert.equal(state.chest.state, "available");
    assert.equal(state.inventory.tokens, 0);
    assert.equal(state.player.hp, 82);
    perform(world, { type: "move", x: 72, y: 50 });
    perform(world, { type: "interact" }, "CHEST_OPENED");
    state = world.snapshot();
    assert.equal(state.quest.complete, true);
    assert(state.quest.steps.every(s => s.status === "completed"));
    assert.equal(state.chest.state, "opened");
    assert.equal(state.inventory.tokens, 10);
    assert.equal(state.events.filter(e => e.type === "reward").length, 1);
});

test("locked chest rejects interaction without advancing progress", () => {
    const world = new World(scene);
    perform(world, { type: "move", x: 72, y: 50 });
    unchangedFailure(world, { type: "interact" }, "CHEST_LOCKED");
});

test("attack requires battle area and attack distance", () => {
    const world = new World(scene);
    unchangedFailure(world, { type: "attack", targetId: "guard-a" }, "OUTSIDE_BATTLE_AREA");
    perform(world, { type: "move", x: 40, y: 50 });
    unchangedFailure(world, { type: "attack", targetId: "guard-a" }, "OUT_OF_RANGE");
});

test("one defeated guard does not clear battle or unlock chest", () => {
    const world = new World(scene);
    perform(world, { type: "move", x: 54, y: 44 });
    perform(world, { type: "attack", targetId: "guard-a" });
    assert.equal(world.snapshot().enemies[0].hp, 10);
    perform(world, { type: "attack", targetId: "guard-a" });
    const state = world.snapshot();
    assert.equal(state.enemies[0].hp, 0);
    assert.equal(state.enemies[1].hp, 20);
    assert.equal(state.battle.cleared, false);
    assert.equal(state.chest.state, "locked");
    assert.deepEqual(state.quest.steps.map(s => s.status), ["completed", "active", "pending"]);
    unchangedFailure(world, { type: "attack", targetId: "guard-a" }, "TARGET_DEFEATED");
});

test("unlocked chest requires interaction radius including boundary", () => {
    const world = new World(scene);
    defeatGuards(world);
    unchangedFailure(world, { type: "interact" }, "OUT_OF_RANGE");
    perform(world, { type: "move", x: 67, y: 50 });
    perform(world, { type: "interact" });
    assert.equal(world.snapshot().inventory.tokens, 10);
});

test("repeat chest interaction is idempotent", () => {
    const world = new World(scene);
    defeatGuards(world);
    perform(world, { type: "move", x: 72, y: 50 });
    perform(world, { type: "interact" });
    unchangedFailure(world, { type: "interact" }, "ALREADY_OPENED");
    unchangedFailure(world, { type: "interact" }, "ALREADY_OPENED");
    assert.equal(world.snapshot().inventory.tokens, 10);
});

test("leaving battle pauses it and reentry preserves damage", () => {
    const world = new World(scene);
    perform(world, { type: "move", x: 54, y: 44 });
    perform(world, { type: "attack", targetId: "guard-a" });
    assert.equal(world.snapshot().battle.active, true);
    perform(world, { type: "move", x: 12, y: 50 });
    assert.equal(world.snapshot().battle.active, false);
    assert.equal(world.snapshot().battle.cleared, false);
    assert.equal(world.snapshot().enemies[0].hp, 10);
    perform(world, { type: "move", x: 54, y: 44 });
    assert.equal(world.snapshot().battle.active, true);
    assert.equal(world.snapshot().enemies[0].hp, 10);
});

test("death blocks all further actions and rewards; reset revives", () => {
    const fragileScene = clone(scene);
    fragileScene.player.maxHp = 6;
    const world = new World(fragileScene);
    perform(world, { type: "move", x: 54, y: 44 });
    perform(world, { type: "attack", targetId: "guard-a" });
    let state = world.snapshot();
    assert.equal(state.player.hp, 0);
    assert.equal(state.battle.active, false);
    assert.equal(state.quest.complete, false);
    assert.equal(state.inventory.tokens, 0);
    unchangedFailure(world, { type: "move", x: 72, y: 50 }, "PLAYER_DEAD");
    unchangedFailure(world, { type: "attack", targetId: "guard-a" }, "PLAYER_DEAD");
    unchangedFailure(world, { type: "interact" }, "PLAYER_DEAD");
    perform(world, { type: "reset" }, "RESET");
    state = world.snapshot();
    assert.equal(state.player.hp, 6);
    assert.equal(state.enemies[0].hp, 20);
});

test("reset restores all progress and event history", () => {
    const world = new World(scene);
    defeatGuards(world);
    perform(world, { type: "move", x: 72, y: 50 });
    perform(world, { type: "interact" });
    perform(world, { type: "reset" }, "RESET");
    const state = world.snapshot();
    assert.equal(state.player.hp, 100);
    assert.equal(state.player.x, 12);
    assert.equal(state.inventory.tokens, 0);
    assert.equal(state.chest.state, "locked");
    assert.equal(state.quest.complete, false);
    assert.deepEqual(state.quest.steps.map(s => s.status), ["active", "pending", "pending"]);
    assert(state.enemies.every(e => e.hp === 20));
    assert.equal(state.tick, 0);
    assert.equal(state.events.length, 1);
    assert.equal(state.events[0].type, "reset");
});

test("invalid actions never change gameplay state", () => {
    const world = new World(scene);
    for (const action of [null, undefined, [], {}, "move"]) unchangedFailure(world, action, "INVALID_ACTION");
    unchangedFailure(world, { type: "teleport" }, "UNKNOWN_ACTION");
    for (const value of [NaN, Infinity, -Infinity, "30", null, undefined]) {
        unchangedFailure(world, { type: "move", x: value, y: 50 }, "INVALID_COORDINATES");
    }
    unchangedFailure(world, { type: "move", x: -1, y: 50 }, "OUT_OF_BOUNDS");
    unchangedFailure(world, { type: "move", x: 50, y: 101 }, "OUT_OF_BOUNDS");
    perform(world, { type: "move", x: 54, y: 44 });
    unchangedFailure(world, { type: "attack", targetId: "missing" }, "TARGET_NOT_FOUND");
    unchangedFailure(world, { type: "attack", targetId: 1 }, "INVALID_TARGET");
});

test("automatic attack picks nearest living guard deterministically", () => {
    const world = new World(scene);
    perform(world, { type: "move", x: 54, y: 44 });
    perform(world, { type: "attack" });
    assert.equal(world.snapshot().enemies[0].hp, 10);
    assert.equal(world.snapshot().enemies[1].hp, 20);
});

test("scene and snapshots cannot mutate engine state", () => {
    const input = clone(scene);
    const world = new World(input);
    input.enemies[0].maxHp = 1;
    input.player.spawn.x = 99;
    const snapshot = world.snapshot();
    snapshot.player.hp = 0;
    snapshot.enemies[0].hp = 0;
    snapshot.scene.combat.attackDamage = 999;
    snapshot.chest.reward.tokens = 999;
    snapshot.quest.steps[0].status = "completed";
    snapshot.events.push({ tick: 0, type: "tampered", message: "tampered" });
    const actual = world.snapshot();
    assert.equal(actual.player.hp, 100);
    assert.equal(actual.player.x, 12);
    assert.equal(actual.enemies[0].hp, 20);
    assert.equal(actual.scene.combat.attackDamage, 10);
    assert.equal(actual.chest.reward.tokens, 10);
    assert.equal(actual.quest.steps[0].status, "active");
    assert.equal(actual.events.length, 1);
});

test("straight traversal records entry even when ending outside", () => {
    const world = new World(scene);
    perform(world, { type: "move", x: 100, y: 50 });
    const state = world.snapshot();
    assert.equal(state.quest.steps[0].status, "completed");
    assert.equal(state.battle.active, false);
    assert.equal(state.battle.cleared, false);
});

test("invalid scene data and dangling references are rejected", () => {
    const mutations = [
        s => { s.schemaVersion = 2; },
        s => { s.bounds.maxX = NaN; },
        s => { s.bounds.maxX = s.bounds.minX; },
        s => { s.player.spawn.x = Infinity; },
        s => { s.player.spawn.x = 101; },
        s => { s.player.maxHp = 0; },
        s => { s.enemies[1].id = s.enemies[0].id; },
        s => { s.quest.steps[0].id = s.chest.id; },
        s => { s.enemies[0].maxHp = -1; },
        s => { s.combat.battleAreaId = "missing"; },
        s => { s.combat.groupId = "missing"; },
        s => { s.chest.unlockGroupId = "missing"; },
        s => { s.quest.steps[0].condition.areaId = "missing"; },
        s => { s.quest.steps[1].condition.groupId = "missing"; },
        s => { s.quest.steps[2].condition.chestId = "missing"; },
        s => { s.quest.steps[0].condition.type = "unknown"; },
        s => { s.areas[0].shape = "polygon"; },
        s => { s.areas[0].radius = 0; },
        s => { s.combat.attackRange = NaN; },
        s => { s.combat.counterDamage = -1; },
        s => { s.chest.reward.tokens = 1.5; },
        s => { s.rules.movement = "real-navigation"; },
        s => { s.provenance = null; },
        s => { s.enemies = []; }
    ];
    for (const mutate of mutations) {
        const invalid = clone(scene);
        mutate(invalid);
        assert.throws(() => new World(invalid), /场景无效/);
    }
    for (const invalid of [null, [], "scene", 123]) assert.throws(() => new World(invalid), /场景无效/);
});

test("browser UMD export works without require or dependencies", () => {
    const context = vm.createContext({});
    vm.runInContext(fs.readFileSync(path.join(__dirname, "world.js"), "utf8"), context);
    assert.equal(typeof context.TaskSandbox.World, "function");
    const world = new context.TaskSandbox.World(scene);
    assert.equal(world.snapshot().player.hp, 100);
    assert.equal(world.dispatch({ type: "move", x: 54, y: 44 }).ok, true);
});

test("unsupported fields and unadapted coordinates fail closed", () => {
    for (const mutate of [
        s => { s.chest.unlockCondition = {type: "script"}; },
        s => { s.quest.steps[0].condition.extra = true; },
        s => { s.combat.criticalChance = 1; },
        s => { s.provenance.coordinateSystem = "game-map"; },
        s => { delete s.provenance.mapLayer; }
    ]) {
        const invalid = clone(scene); mutate(invalid);
        assert.throws(() => new World(invalid), /场景无效/);
    }
});

process.stdout.write("\n" + passed + " tests passed. No game process or real input was used.\n");
