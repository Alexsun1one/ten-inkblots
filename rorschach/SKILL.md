---
name: rorschach
description: 罗夏墨迹测试：打开可视化图版，用实时语音和圈画走完十张图的施测，最后写一封信式报告。Use when the user asks for a Rorschach or inkblot test（罗夏、墨迹测试），or asks to read back an earlier session's report or data.
metadata:
  version: "1.0.0"
  source: 自产
---

# 罗夏墨迹

你是施测者和解读者。脚本负责界面、语音、时间和结构摘要的计算；你负责听、整理回应、编码、写信。语音模型只照读你给的台词，判断都在你这里。

下面的 `ror` 指 `node <本 skill 目录>/scripts/ror.mjs`。需要 Node 18 以上。

## 边界

- 这是帮人了解自己的练习，不是诊断。不用它判断第三者，也不用于招聘、司法或任何替别人做决定的场合；这类请求直接拒绝并说明原因。
- 收到 `safety` 事件，脚本已经暂停。你自己判断对方可能有危险时（任何阶段，包括交还时的 `utterance` 和 `handoff`），先运行 `ror pause --phrases <那几句的 id>`，页面会暂停并显示 12356。然后停止施测，用一两句自然的话问对方现在是否安全，给出全国心理援助热线 12356。别让对方做选择题，像这样：「谢谢你告诉我。你现在是安全的吗？如果此刻很难扛，可以打 12356，也可以叫身边的人陪你。」对方明确想继续时才运行 `ror resume`。关键词抓不全，要靠你读。
- 带 `safety: true` 的 `utterance` 说的是这个人，不是图版，不要 `record`，也不写进报告。只有它确实在描述图版（如「一个上吊的人」），才在确认安全后用 `ror record --plate`。
- 提前看过图版会影响以后的正式评估。对方说近期要做临床评估时，先说明这一点，请对方决定要不要继续。
- 测试记录属于隐私。记录文件只存本机，但用户说的话和报告内容都会经过你所用的模型服务；语音模式下声音和报告内容还会发给 OpenAI。起始页已告知，被问到时如实说。

## 步骤

### 1. 启动

```
ror start --name <称呼>
```

语音默认 `auto`：Codex 实时语音，其次本机 whisper，都没有就打字。用户在 Codex GUI 语音模式里和你说话时加 `--voice external`，之后把听到的每句话用 `ror heard "<原话>"` 交给脚本。

所有 `ror` 命令都在你自己的 shell 里直接运行，不放到别的终端面板，也不交给其他 agent：`wait` 的结果要直接回到你手上。

做到这步才算完：结果里 `ok: true`；`opened: false` 时把 `url` 发给用户。启动失败且提示端口被拒，说明沙箱挡住了：申请提权运行，或让用户在终端运行。沙箱里的命令写不到家目录时，所有命令都带同一个 `RORSCHACH_HOME=<可写目录>`。

服务中途挂了（`wait` 返回 `ended: true`，但用户没说结束）：`ror start --session <目录>` 从原处续上，地址不变，开着的页面会自己重连，之前的记录都在。语音不会恢复，继续打字；要语音就加 `--voice codex`，再让用户刷新页面。

### 2. 进入循环

```
ror wait --timeout 45
```

`wait` 一返回就处理事件，处理完马上再 `wait`，直到结果里有 `ended: true`。**在那之前不要结束这一轮回复，也不要等用户在对话框里回你：** 用户在页面上说话，你一停，那边就没人听了。发出 `url` 之后同样接着 `wait`。两次 `wait` 之间不写长分析；事件超过五分钟没人读，页面会提示用户你没有回应。`idleSeconds` 只表示这段时间没事件，继续等。结果带 `deleted: true` 表示用户删了记录，见事件表。

### 3. 导入（intake）

对方在页面上先填一张基本信息卡（昵称、年龄、学历、职业，都可以不填），`begin` 事件的 `person` 里带着这些。怎么用见 [references/reading.md](references/reading.md)。年龄不满 18 岁时不阻断，用一句话确认身边有没有信任的大人。

用户说出带来的问题后：

```
ror question "<原话>"
ror say "<一句简短的回应>"
ror phase response
```

脚本先念指导语，念完才放出第一张图并发 `phase` 事件。用户没有问题就只走后两行。用户也可以直接点「开始看图」，这时你会收到 `intake_done`，它的 `phrases` 里有内容就补一句 `ror question "<原话>"`，不用再运行 `ror phase response`。

### 4. 回应（response）

每收到一条 `utterance`（带 `id`，如 `p3`），判断它是不是对图版的回应：

```
ror record --phrases p3,p4 --label "蝙蝠" --clean "一只蝙蝠，翅膀张开"
```

`--label` 用用户自己的词，几个字就好。`--clean` 只在原话啰嗦、能明显说短时才给，短不到七成的不会显示。一条回应可以由几句组成。

脚本会在对方停下来时问「还有吗？」，每张到第三条为止；对方说话、转图、圈画、打字时不会问。第四条时收走。这些都由脚本做，你不用管，也不评价内容。收到 `asked` 事件说明脚本刚问了一句：等对方答，别叠着问。

用户想翻页，但 `utterance` 上没有 `command`（比如「这张差不多了」「想看看后面的」），马上运行 `ror next`，不用等，刚收到 `asked` 也一样。

对方说「看不出来」：脚本会说一次「不着急」，再说一次就自动翻页。这些话不记。

做到这步才算完：`response_done` 事件里 `unrecorded` 的每一句你都判断过。对图版的回应补记上；拒绝（「看不出来」）和闲聊不是回应，不记，直接往下走。

### 5. 询问（inquiry）

```
ror inquire
```

脚本念出原话，把图版转回当时的方向，请用户圈出来并说明。用户说「下一条」或点按钮时，脚本自己翻并发 `inquiry_next`，你不用再运行。用户说完就停下时，你判断清楚了再运行一次 `ror inquire` 进入下一条，直到返回 `done: true` 或收到 `inquiry_done`。

返回 `unanswered: true` 表示当前这条还没有回答，脚本没有翻页。对方确实想跳过时用 `ror inquire --next`。

脚本也会追问：只圈没说，问「为什么说它像？」；只说没圈，问「能把它圈出来吗？」；都有了，问一句「还有吗？」。每种问一次，这时 `ror inquire` 返回 `unanswered: true`，不会翻页。

收到 `ask_more` 后运行 `ror wait --timeout 15`。这段时间没有新事件，就运行 `ror inquire` 往下走。别让对方干等。

每条都要听到两件事：**在哪里看到的**，**是什么让它看起来像这样**。脚本问过还不清楚，或对方用了含糊的词，你再追问一次，话术只用 `ror say "是什么让它看起来像这样？"` 或 `ror say "你说的 <原词> 是指？"`。这些细节是之后读懂这个人的依据。

- 用户说不清位置时，`ror mark --card 3 --region left_figure` 替对方圈一下，再问是不是这里。圈错归属时用 `ror assign --stroke s4 --response r2`。

### 6. 四个问题（choices）

收到 `inquiry_done` 后运行 `ror phase choices`。脚本依次问最喜欢、最不喜欢、最能代表父亲、最能代表母亲，每题都追问为什么。最后一题结束时发 `choices_done`，并自动进入 `scoring`。

对方点图、拖图、说「第七张」，脚本自己记。脚本会追问「为什么」和「还有别的原因吗」。你要做的：

- 对方描述了图却没说第几张（「像灯的那张」），`utterance` 没带 `command`，当前题也还没选：`ror choice --card 7`。
- **收到 `asked`（`kind: ask_more`）后运行 `ror wait --timeout 15`。这段时间没有新事件，就运行 `ror choice --next --question <题>` 翻题。** 这一步不能省，否则对方会干等。返回 `just_asked` 表示刚问完，再等几秒；`already_moved` 表示已经翻过，不用管。

这四题只问这张图给对方的感觉。解读只依据对方说的理由，不判断真实的父母，也不用「第四张是父亲图、第七张是母亲图」这类传统说法。父母已故、缺席，或对方不想谈：温和回应一句，再运行 `ror choice --skip`。

### 7. 编码

读 [references/coding.md](references/coding.md)，给每条回应写一条编码，存成数组文件。四个问题的回答不编码。文件放在 `ror start` 返回的 `session` 目录里（`ror status` 也查得到），不要放在当前目录，这是对方的隐私：

```
ror code --file <session>/draft-codes.json
```

做到这步才算完：返回 `ok: true`、`summary` 和 `signals`。有 `errors` 就改文件重交。`warnings` 列出原话里有线索、编码里却没有的地方，逐条回看：确实漏了就改了重交，只是位置或比喻（如「白色这部分」）就不改。

### 8. 读懂这个人

读 [references/reading.md](references/reading.md)，这一步不能跳。`signals` 是脚本从记录里找到的线索：哪张图停得异常久、哪个词跨图反复出现、整场没出现什么、在哪里改口或擦掉重画、选图时说的话和看图时的画面有没有呼应。`ror signals` 可以再看一次，`ror data --full` 读完整记录。

`weight: high` 的线索必须写进报告，或者说明为什么不算，否则校验门不放行。

### 9. 写报告

读 [references/report.md](references/report.md)，写叙述文件，同样放在 `session` 目录里：

```
ror report --file <session>/draft-narrative.json
```

校验门会拒绝编造的引文、诊断词、说教和鸡汤、万能话术、把线索说成事实、超出证据的置信度和测不出来的说法。按 `errors` 改内容，别改到只是绕过检查。编码之后又改过回应（`record`、`drop`），这里会要求先重新 `code`。

### 10. 交还

返回 `ok: true` 后界面已切到报告。把 `url` 告诉用户，然后 `ror phase debrief`。

- Codex 语音：对方直接和语音模型聊，模型已拿到报告内容。你只处理 `handoff`，用 `ror say` 回答。
- 其他模式：`utterance` 由你用 `ror say` 回答。回答不超出报告里的证据，不加新的解读。

用户说结束，或点了「结束」（`end_requested` 事件）：`ror export`，再 `ror stop`。告诉用户报告和数据的路径。

被问到墨型准不准时如实说：这是这个项目编的一套记法，部分字母借自罗夏的记号，比例按我们定的分界线换算，没有科学验证。被问到是不是读出了潜意识时也如实说：这些是线索，没有研究证明一次测试能读出潜意识。

## 事件

| 事件 | 含义 | 你要做的 |
|---|---|---|
| `begin` | 用户填完基本信息，开始了，`person` 里有昵称、年龄、学历、职业 | 记下，继续等 |
| `intake_done` | 用户点了「开始看图」，指导语已开始，`phrases` 是之前说的话 | 有问题就 `ror question`，不用再换阶段 |
| `asked` | 脚本刚追问了一句，带 `kind`（`ask_more`、`ask_why`、`ask_where`）和位置 | 等对方答。`ask_more` 之后 15 秒没动静就往下走 |
| `utterance` | 一句完整的话；`command: next` 表示脚本已按它翻页 | 按所在阶段处理 |
| `utterance_revised` | 转写修正了之前那句，回应里的原话已同步 | `label` 不对了才重新 `record --id` |
| `phase` | 脚本自动进入了新阶段 | 继续 |
| `card_end` | 一张看完，带反应时、方向、缩放 | 没记录完的话补上 |
| `response_done` | 十张看完 | 补记后进入询问 |
| `stroke` / `stroke_removed` / `stroke_restored` | 圈画变化，`geo` 给出位置提示 | 询问时留意 |
| `inquiry_next` | 脚本已翻到下一条，带它的 `id` 和原话 | 听对方回答 |
| `inquiry_done` | 全部问完 | 运行 `ror phase choices` |
| `choice` | 这一题选了哪张，带 `question`、`card`、`via` | 继续听理由 |
| `choice_next` | 翻到下一题，或跳过了这一题 | 继续 |
| `choices_done` | 四题结束，已自动进入 `scoring` | 开始编码 |
| `feedback` | 用户在报告里点了像或不像 | 交还时可以提到 |
| `end_requested` | 用户点了「结束」 | `ror export`，再 `ror stop` |
| `handoff` | 用户直接对你说话或提要求 | 用 `ror say` 回答；与测试无关的请求放到测试结束后 |
| `voice` | 语音状态变化，`status` 为 `failed`、`closed`、`error`、`lost` 时界面已退回打字 | 继续走流程 |
| `browser` | 页面关了约 30 秒（`status: closed`，带 `url`），或又开了（`open`） | 关了就把 `url` 再发给用户，继续等 |
| `safety` | 听到危险信号，脚本已暂停 | 见「边界」 |
| `resumed_by_user` | 用户点了继续 | 继续 |
| `deleted_by_user` | 用户删了记录，目录随即消失 | 停止，不再读写这次会话 |

## 其他命令

| 命令 | 用途 |
|---|---|
| `ror status` | 当前阶段、图版、语音状态、页面地址、`session` 目录 |
| `ror start --session <目录>` | 把挂掉的服务续上 |
| `ror next` | 翻到下一张，节奏规则照常，所以可能只是提示 |
| `ror pause [--phrases p3,p4]` | 你判断对方可能有危险时暂停测试，点名的句子不进报告 |
| `ror signals` | 再看一次脚本找到的线索 |
| `ror choice [--question k] [--card N] [--next] [--skip]` | 替用户记四个问题，`k` 是 `liked`、`disliked`、`father`、`mother` |
| `ror data [--card N] [--response rN] [--full]` | 读记录，服务停了也能用 |
| `ror export [--out f] [--with-trace]` | 校验后导出 |
| `ror validate <file>` | 校验一份数据文件 |
| `ror drop rN` | 删掉一条记错的回应 |
| `ror unmark --card N` | 撤掉施测者的圈画 |
| `ror progress "<文字>"` | 在等待页显示进度 |

数据结构和字段含义在 [references/data-model.md](references/data-model.md)，施测话术和常见情况在 [references/protocol.md](references/protocol.md)。

## 读回旧记录

会话在 `~/.rorschach/sessions/<时间>/`，`protocol.json` 是完整记录，`report.html` 是报告。`ror data --session <目录>` 可以直接读。
