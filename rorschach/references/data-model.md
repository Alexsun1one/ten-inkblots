# 数据

每次会话三层，后一层都能从前一层重新算出来。

| 文件 | 内容 | 什么时候读 |
|---|---|---|
| `trace.jsonl` | 只追加的事件流，每行 `{seq, t, src, type, phase, ...}`，无损 | 查细节、重新推导 |
| `protocol.json` | 确定性推导出的层级记录 | 平时读这个 |
| `schema/protocol.schema.json` | JSON Schema 2020-12，严格 `additionalProperties: false` | 校验、对接 |

`ror export` 先过 schema 再过语义校验，失败就拒绝导出。

## 层级

```
protocol
├─ session, participant, stimulus, administration, phases
├─ cards[10]
│  ├─ timing, pacing, orientation, view
│  ├─ exposures[]            每次呈现（回应一次，询问可能再来）
│  │  └─ gestures[]          一次操作：zoom pan rotate transform fit board
│  │     └─ samples[]        [dtMs, z, cx, cy, deg]，最多 80ms 一个
│  ├─ responses[]
│  │  ├─ freeAssociation.utterances[]
│  │  ├─ inquiry.utterances[]
│  │  ├─ location.strokes[]  points 与 pointTimes
│  │  └─ code
│  ├─ unassigned             说了但没归入回应的话和圈画，包括被 drop 的回应留下的
│  └─ removedStrokes         擦掉的也留着
├─ other                     不属于任何一张的话和操作
├─ choices                   四个问题：选了哪张、为什么、改选历史、整桌呈现
├─ transcript                按时间排的全部对话
├─ safety, scoring, narrative, feedback
└─ integrity                 traceSha256 和计数
```

## 约定

`participant` 含 `name`、`age`、`education`、`occupation`、`question`，都可以为 null。`scoring.summary.inkType` 是墨型：`code`、四条 `axes`（每条带 `leftPct`、`rightPct`、原始计数 `a`、`b`，`even` 表示两边差不多）、`ingredients`（本人回应里的占比，不和任何人比）。卡片的 `pacing` 记录脚本的追问，`kind` 有 `nudge`、`prompt_more`、`hint`、`pull`、`ask_more`、`ask_why`、`ask_where`。

这些约定也随数据写在 `conventions` 字段里。

| 项 | 约定 |
|---|---|
| 时间 | 相对 `session.createdAt` 的整数毫秒，服务器时钟。浏览器事件每批重新锚定 |
| 坐标 | 图版自身坐标：直立时左上 0,0，右下 1,1。与旋转缩放无关 |
| 角度 | 顺时针度数，0 为直立 |
| 方向记号 | `∧ > ∨ <`，尖指向图版上沿；自由角度取最近象限 |
| 缩放 | `z = 1` 是按上次静止角度适配视口；`w` 是图版 CSS 像素宽 |
| 视图 | `cx, cy` 是视口中心在图版坐标里的位置；`visible` 是图版在窗口内的比例，记录屏幕上有什么，不是眼动 |
| 反应时 | `rtMs` 从图版绘制完成并到位（`onsetBasis: painted`，回退 `server`）到开口 |
| 开口依据 | `rtBasis`：`vad` 麦克风电平，`typing` 第一个按键，`transcript` 第一个转写文字（最慢） |

## 常用读法

```sh
ror data                         # 去掉采样和笔迹点的精简版
ror data --card 3                # 一张图
ror data --response r5 --full    # 一条回应，含全部笔迹点
ror export --with-trace --out f  # 带原始事件流的完整文件
ror validate f                   # 校验
```

第 III 张怎么转的：`cards[2].orientation.changes` 给每次转动，`dwellMs` 给停留在四个方向的时长。

一条回应当时怎么看的：`viewAtOnset`（开口那一刻的视图）和 `orientation`。

话语上的 `command: true` 表示它只是在翻页（「下一张」「下一条」），不算回答，不进 `verbatim`，也不进 `transcript`。

`safety: true` 表示这句话触发了安全暂停，或是在暂停中说的。它说的是这个人，不是图版：留在 `unassigned.utterances` 和 `transcript`，不算反应时，也不进节奏判断。`report.html` 里内嵌的数据把这些话换成占位，完整内容只在本机的 `protocol.json`。

语音中途断了：`administration.voice.changes` 记下何时、为何，`mode` 是最后实际用的方式。服务重启：`trace.jsonl` 里有 `session.restart`，id 接着编号，不会重用。

报告页的「下载数据」按钮得到的是同一份 `protocol.json`。
