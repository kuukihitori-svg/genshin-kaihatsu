const DEMO_SCENE = {
  "schemaVersion": 1,
  "id": "synthetic-camp-demo",
  "title": "营地任务与宝箱解锁演示",
  "description": "进入营地、击败两名守卫，再打开宝箱。所有动作由二维规则计算；移动仅为简化直线，不代表真实原神寻路或战斗。",
  "provenance": {
    "kind": "synthetic",
    "notice": "所有坐标、人物、任务条件、战斗数值和奖励均为合成示例，并非真实原神任务或游戏数据。",
    "source": "本仓库手工合成",
    "version": "demo-1",
    "mapLayer": "synthetic-surface",
    "coordinateSystem": "sandbox-cartesian-v1"
  },
  "bounds": {
    "minX": 0,
    "maxX": 100,
    "minY": 0,
    "maxY": 100
  },
  "player": {
    "spawn": {
      "x": 12,
      "y": 50
    },
    "maxHp": 100
  },
  "areas": [
    {
      "id": "camp",
      "name": "演示营地",
      "shape": "circle",
      "x": 60,
      "y": 50,
      "radius": 24
    }
  ],
  "combat": {
    "battleAreaId": "camp",
    "groupId": "camp-guards",
    "attackDamage": 10,
    "attackRange": 12,
    "counterDamage": 6
  },
  "enemies": [
    {
      "id": "guard-a",
      "name": "守卫甲",
      "x": 54,
      "y": 44,
      "maxHp": 20,
      "groupId": "camp-guards"
    },
    {
      "id": "guard-b",
      "name": "守卫乙",
      "x": 65,
      "y": 55,
      "maxHp": 20,
      "groupId": "camp-guards"
    }
  ],
  "chest": {
    "id": "camp-chest",
    "name": "营地宝箱",
    "x": 72,
    "y": 50,
    "interactionRange": 5,
    "unlockGroupId": "camp-guards",
    "reward": {
      "tokens": 10
    }
  },
  "quest": {
    "id": "camp-quest",
    "title": "清理演示营地",
    "steps": [
      {
        "id": "enter-camp",
        "title": "进入营地",
        "condition": {
          "type": "enter-area",
          "areaId": "camp"
        }
      },
      {
        "id": "defeat-guards",
        "title": "击败守卫",
        "condition": {
          "type": "defeat-group",
          "groupId": "camp-guards"
        }
      },
      {
        "id": "open-chest",
        "title": "打开宝箱",
        "condition": {
          "type": "open-chest",
          "chestId": "camp-chest"
        }
      }
    ]
  },
  "rules": {
    "movement": "straight-line",
    "movementNotice": "移动瞬时沿直线到达目标；路径与圆形区域相交即记录进入，战斗是否进行由终点决定。没有真实碰撞、层高、体力或寻路。",
    "combatNotice": "在营地内、攻击范围内可攻击守卫；每次成功攻击后，只要本组仍有存活守卫，就固定反击一次 6 点。移动和失败动作不触发反击。",
    "rewardNotice": "指定守卫组全灭才解锁宝箱；进入交互范围后可领一次 10 枚演示代币。角色倒下后只允许重置。"
  }
}
;