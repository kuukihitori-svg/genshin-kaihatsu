# 攻略视频到 BetterGI 路线：伦波岛 P2

已生成 [BetterGI 开图脚本实验版](../bettergi/nod-krai-p2/README.md)，包含 12 个路线片段、159 个途经/目标点和执行 JS，按用户确认的“神像已亮、相关剧情未完成”状态处理。可导入运行，尚未做实机验收。2 号途经点为编号图人工量取，7→8 部分滑翔为连续区间插值，来源均保留；不是全部坐标都由绝对匹配得到。

原视频全体 15,612 帧已解码，SIFT/RANSAC 与相邻帧光流获得 7,544 帧位置估计。其余包含黑图、菜单、剧情和定位不足的帧；关键操作、连续性联系表和自动转写做了交叉核对，不声称人工逐一看完所有帧。现有二维沙盘继续用于合成任务规则测试。

## 已取得的素材与结果

- 来源：[某橙sama，BV1XSHDzqE2h，P2](https://www.bilibili.com/video/BV1XSHDzqE2h/?p=2)，伦波岛那夏镇／叮铃咣啷蛋卷工坊，1—10 号点位。
- 本次完整下载视频和音轨，无需账号登录。1920×1080、30 fps，FFprobe 实测 520.405333 秒；公开目录四舍五入为 8:41。
- 素材 SHA-256：`1c19533c7177731b8d26f8474d3091c6289effb73313595f9dcd030ef71b1447`。音视频已合并为 MP4。
- 全时长按 5 秒采样，取得 105 帧并审阅联系表；另按源帧率抽取 615 帧，覆盖地图、锚点交互、升降台、剧情转场和秘境门。只检查了这些区间的代表帧，未逐帧人工看完全部视频。
- 未取得解说字幕。独立字幕接口提示需要登录；保存的弹幕 XML 不作为字幕或解说证据。
- 媒体、截图、原始 yt-dlp 元数据保留在云端 `/workspace/genshin-video-study`，不进入 Git。原始元数据含短期媒体 URL，账号 Cookie 也不应进入仓库。

本次可直接打开 `/workspace/genshin-video-study/review/review.html`，支持视频回看、时间戳跳转、近似逐帧定位、观察记录、JSON 导入/导出，以及关键片段的原始分辨率帧浏览。浏览器如果限制 `file://`，在云端启动本地静态服务：

```sh
python3 -m http.server 8001 --bind 127.0.0.1 --directory /workspace/genshin-video-study
# 对应浏览器访问 http://127.0.0.1:8001/review/review.html
```

浏览器的视频单帧步进受解码器寻址精度影响；精细检查使用下方原帧浏览器，它按 FFmpeg 实际呈现时间戳索引 JPEG。JPEG 保留原始分辨率，采用有损编码。

## 目标对应关系

用视频 2 秒处的固定、朝北编号地图匹配 BetterGI `0.66.0` 的传送点。1、3、9 号作为控制点，其余七点交叉检查；1920×1080 图上的最大残差 **4.2438 px**。这说明目标对应关系一致，不代表已经恢复玩家的连续位置或可通行地形。

| 视频编号 | BetterGI tpId | 目标 | 路线 X | 路线 Y | 高度 |
|---|---:|---|---:|---:|---:|
| 1 | 1681 | 那夏镇南侧起点 | 9364.397 | 1425.700 | 204.3502 |
| 2 | 1730 | 那夏镇锚点 | 9452.110 | 1661.607 | 228.067 |
| 3 | 1516 | 伦波岛新月神像 | 9496.254 | 1731.140 | 226.0192 |
| 4 | 1682 | 那夏镇高处锚点 | 9528.840 | 1628.450 | 304.981 |
| 5 | 1736 | 镇外低处锚点 | 9658.440 | 1729.820 | 206.6315 |
| 6 | 1726 | 北方训练场 | 9728.011 | 1808.961 | 256.4443 |
| 7 | 1727 | 起重设备平台 | 9873.979 | 1717.405 | 261.1723 |
| 8 | 1719 | 蛋卷工坊 | 10021.300 | 1538.585 | 204.326 |
| 9 | 1690 | 无光的深都 | 9971.470 | 1828.780 | 203.310 |
| 10 | 1728 | 伦波岛锚点 | 9745.460 | 1912.690 | 201.1212 |

原始 `tp.json` 的 `position` 为 `[纵向, 高度, 横向]`，路线坐标 **X=position[2]，Y=position[0]**。[BetterGI GiWorldPosition.cs](https://github.com/babalae/better-genshin-impact/blob/0.66.0/BetterGenshinImpact/GameTask/AutoTrackPath/Model/GiWorldPosition.cs) 的 blob SHA 为 `bb1611580bbd032abc10e78769434ccbc08cab1a`。不能直接取三维数组前两项；也不要混淆 2 号与高出约 77 米的 4 号。

可复算数据：

- `nod-krai-p2.anchors.json`：来源版本、文件哈希、原始三维坐标、人工量取的地图像素、控制点标记。
- `nod-krai-p2.targets.json`：按上述轴规则转换的目标坐标、地图变换与各点残差；不是导航文件。
- `nod-krai-p2.study.json`：10 段时间轴、画面观察、证据时间戳、目标和待实机确认项。
- `nod-krai-p2.navigation.json`：脚本使用的路线证据、每点来源与时间、目标和特殊交互信息。可用 `python3 tools/build_open_map.py --zip dist/伦波岛开图P2-0.2.1.zip` 复建导入包。

## 对脚本实现有影响的观察

1. 起点已经可传送；视频未展示首次激活。脚本必须先检查起点可用性。
2. 2→3 和回镇前往 4 号涉及升降设施。210 秒可见“上行／下行”；不能把低处和屋顶坐标直接相连。
3. 5→6 经过特殊装置。302 秒对白、303 秒载入、310 秒黑屏字幕及 315 秒剧情镜头，任务名称和前置尚未证实；需要单独处理剧情状态。
4. 作者的点位计数会提前增加。9 号在 473 秒已计数，但 476 秒门纹仍红，476.5 秒才转蓝。成功检测应依据游戏画面和状态。
5. 3→4、9→10 含回程传送；10 号实际从训练场方向上坡后滑翔抵达。按编号简单连线会遗漏返回和地形。

## 复现下载与分析

需 Python 3.9+、FFmpeg/FFprobe；媒体分析另需 Pillow，下载需 yt-dlp。应用与原沙盘仍无新增 npm 运行时依赖。

```sh
python3 -m venv --system-site-packages /tmp/genshin-video-venv
/tmp/genshin-video-venv/bin/pip install -r video-study/requirements.txt

# 只下载指定分 P，使用分块请求，并保留 BV 与分 P 标识。
/tmp/genshin-video-venv/bin/python tools/video_study.py fetch \
  'https://www.bilibili.com/video/BV1XSHDzqE2h/?p=2' --out ../genshin-video-study

/tmp/genshin-video-venv/bin/python tools/video_study.py prepare \
  --media ../genshin-video-study/BV1XSHDzqE2h_p2.mp4 \
  --info ../genshin-video-study/BV1XSHDzqE2h_p2.info.json \
  --out ../genshin-video-study/review --interval 5 \
  --study video-study/nod-krai-p2.study.json

python3 tools/video_study.py align-map \
  --anchors video-study/nod-krai-p2.anchors.json --out /tmp/targets.json

# 原帧率截取，不重采样；每次最长15秒，输出目录须为空。
python3 tools/video_study.py clip \
  --media ../genshin-video-study/BV1XSHDzqE2h_p2.mp4 \
  --start 105 --end 108 --out ../genshin-video-study/point02-detail

# 修改标注后重建回看页，不重新解码整段视频。
python3 tools/video_study.py review \
  --manifest ../genshin-video-study/review/manifest.json \
  --study video-study/nod-krai-p2.study.json
```

`prepare` 校验分 P 身份和媒体时长，并记录 SHA-256。抽帧保存实际 PTS；输出目录中已有帧时拒绝覆盖，修改文字可用 `review`。关键帧图集可独立打开 `frames.html`。本次额外图集链接记录在本地 `manifest.json.detailClips`。

浏览器导出的观察在 `reviewNotes` 内，未保存到磁盘的观察刷新后会丢失。重新关联本地视频时请核对 SHA-256；文件选择本身不证明素材身份。

## 导航导出与剩余工作

`export` 当前仅支持导航 JSON。要求选定段无未确认项、`route.status=reviewed`、`coordinateSystem=bettergi-pathing-v1`、`mapLayer=Teyvat/surface`、起始传送点已解锁，以及至少两个带来源和证据时间戳的坐标。每点使用 `x/y/type/move_mode/coordinateSource/evidenceTimeSeconds`，首点为 `teleport`，末点为 `target`；只接受已实现的移动类型与空动作。中间步骤未知时拒绝导出，输出名称标明“仅导航，待实机验收”。

```sh
# 对当前样本应明确失败，不产生虚构路线。
python3 tools/video_study.py export --study video-study/nod-krai-p2.study.json \
  --segment point-07 --out /tmp/point-07.json
```

原研究工具的 `export` 仍只接受完整核对过的纯导航标注。新的实验脚本由 `build_open_map.py` 从 `nod-krai-p2.navigation.json` 构建；它保留近似点和飞行插值的标记，并使用实际位置、OCR 交互和地图面板检查结果。两种输出的验收状态不能混淆。

逐帧研究可用单独的分析依赖复现（Windows 执行 BetterGI 脚本不需要这些依赖）：

```sh
/tmp/genshin-video-venv/bin/pip install -r video-study/analysis-requirements.txt
/tmp/genshin-video-venv/bin/python tools/track_nod_krai.py \
  --media ../genshin-video-study/BV1XSHDzqE2h_p2.mp4 \
  --out ../genshin-video-study/reproduced-audit --samples
```

该追踪器仅适配这条素材的分辨率、小地图布局和 SHA-256；不会把陌生视频套用同一标定。输出每帧状态、绝对匹配数、光流状态和位置估计，素材/原始审阅图不入 Git。绝对匹配缺口没有自动填成“已观测”位置。

[BetterGI 路线格式](https://www.bettergi.com/dev/pathing-dev.html)、[脚本目录格式](https://www.bettergi.com/dev/js/create.html)、[OCR接口](https://www.bettergi.com/dev/js/rec.html)及 0.66.0 的 `Genshin`、`LimitedFile`、`CameraRotateTask` 接口源码已核对。[AutoPathingScript](https://github.com/babalae/better-genshin-impact/blob/0.66.0/BetterGenshinImpact/Core/Script/Dependence/AutoPathingScript.cs) 有捕获异常仅记录日志的路径，执行 JS 在每个路线片段后重新验证实际位置。目标解锁证据为对应面板的精确“传送”按钮，或原生传送成功并确认到达位置；0.2.1 改用后者预检神像，避免通用点选误开标记面板。没有连接真实原神或声称实机成功。

## 验证

```sh
npm test                         # 17组现有引擎规则测试
npm run test:video               # 13组新测试，包括实际FFmpeg合成媒体抽帧
npm run test:browser             # 原沙盘Chromium交互回归
npm run test:study-browser -- /workspace/genshin-video-study/review/review.html
npm run test:bettergi             # 16组宿主模拟/包结构检查
```

Python 测试涵盖分 P 校验、时间戳、坐标重排、地图残差、无效输入、缺失路线拒绝导出与 JSON 嵌入转义。合成测试视频仅用于抽帧合同校验，不代表真实路线成功。

Chromium 回看测试读取本次真实视频，检查时间跳转、帧步进、观察导出、错误分 P／错误 JSON 导入保留现状、文本安全、390px 布局和原分辨率帧图集。使用进程内 HTTP 路由读取本地文件，范围请求限制内存，不访问外网。托管浏览器禁用 `file://`，因此测试不直接打开文件 URL。浏览器测试需可解析的 Playwright 和 Chromium；当前云环境均提供。
