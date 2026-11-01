<p align="center"><img src="docs/images/hero.jpg" alt="十张墨迹" width="100%"></p>

# 十张墨迹

在 Codex 里说一句「我想做一次罗夏墨迹测试」，它会打开一个本地页面，陪你看完十张图，最后写一封信给你，再告诉你这次是十六种墨型里的哪一种。

你对着图说话，用手圈出看到的地方，图可以转，也可以放大。每一句话、每一笔、每一次转动都记在你自己的电脑上。

> 这是帮你了解自己的练习，不能当诊断，也不能代替心理咨询。如果最近很难熬，请找一位真人聊聊：全国心理援助热线 **12356**。

<details>
<summary>English</summary>

An agent skill for Codex. Say you want to take the Rorschach inkblot test and it opens a local page, talks you through the ten plates by realtime voice, lets you circle, rotate and zoom, then writes you a letter-style report and gives you one of sixteen made-up ink types to share. Every word and stroke is kept as structured JSON on your own machine. It is a self-exploration exercise, not a diagnosis. The interface and the report are in Chinese.

</details>

## 开始

1. 把这句话发给 Codex：

   ```text
   安装这个 skill：https://github.com/Alexsun1one/ten-inkblots/tree/main/rorschach
   ```

2. 新开一个对话，说：

   ```text
   我想做一次罗夏墨迹测试
   ```

3. 浏览器会打开起始页。点「开始」，填一张小卡片，跟着声音走。

留出半小时到一小时，找个安静的地方。这个时长是估计，还没有拿真人实测过。

如果近期要做正式的临床评估，请先别做这个：提前看过图版会影响评估结果。

### 需要什么

| 你有 | 能用什么 |
|---|---|
| Node 18 以上 | 必需 |
| Codex CLI，已登录 ChatGPT | 实时语音（实测 codex-cli 0.166、ChatGPT Pro） |
| whisper.cpp，让 Codex 运行 skill 里的 `scripts/setup-voice.sh`，会下载约 190MB 模型 | 本地听写加系统朗读，语音连不上时自动退回 |
| 都没有 | 打字 |

Codex 的沙箱可能挡住本地服务，这时它会请你批准提权。服务只监听 `127.0.0.1`，地址里带一次性的随机密钥。

## 会发生什么

<img src="docs/images/flow.jpg" alt="看、圈、问、选、信" width="100%">

1. **认识一下。** 昵称、年龄、学历、职业，都可以不填。这些只用来读懂你说的话，不和任何人比。
2. **带一个问题来。** 想问就问，不想问就跳过。
3. **十张图。** 每张说两到三个看到的东西。你停下来，它会问一句「还有吗」；说到第四个会收走。
4. **回看。** 把你说过的话一条条念回来，请你圈出位置，说说是什么让它看起来像这样。
5. **四个问题。** 最喜欢哪张，最不喜欢哪张，哪张最能代表父亲，哪张最能代表母亲，每题都问为什么。可以点图、拖图、直接说第几张，也可以跳过。
6. **一份报告。** Codex 给每条回应编码，脚本算结构摘要、墨型和线索，校验门检查写好的内容，然后页面切到报告。你可以接着问它任何一句话的依据。

每一步都有下一步的按钮，也可以直接说「下一张」。

原版在回应阶段问得更少。这里多问是有意的：让人多说一点，回应数可能因此偏多，报告的方法段写了这一点。

<table>
<tr>
<td width="50%"><img src="docs/images/person.jpg" alt="开始前的小卡片"></td>
<td width="50%"><img src="docs/images/plate.jpg" alt="看图和圈画"></td>
</tr>
<tr>
<td><img src="docs/images/choices.jpg" alt="四个问题"></td>
<td><img src="docs/images/scoring.jpg" alt="等待写信"></td>
</tr>
</table>

## 报告

报告是一个可以离线打开的网页，文件里自带全部图版和数据。每个人的封面墨迹都由这次的圈画生成，所以不会和别人的一样。

<table>
<tr>
<td width="50%"><img src="docs/images/report-seen.jpg" alt="一句话"></td>
<td width="50%"><img src="docs/images/report-letter.jpg" alt="一封信"></td>
</tr>
<tr>
<td><img src="docs/images/report-under.jpg" alt="水面下"></td>
<td><img src="docs/images/report-plate.jpg" alt="逐张记录"></td>
</tr>
</table>

- **一句话**：这次最值得说的那件事，用你自己的词。
- **一封信**：引用你的原话，重点用朱砂标出来。
- **记住这三件**：合上报告之后最该带走的三句。
- **水面下**：你没打算说、但留下痕迹的东西，比如停顿、改口、在不同图上重复出现的词。每条都写看到了什么、可能是什么、另一种解释，再问你一句。
- **还有**：带证据和置信度的画像、四张选择、同一件事的光与影、这周可以试的小事、十张图上你的圈画和原话、结构摘要的图表。

### 十六墨型

<table>
<tr>
<td width="50%"><img src="docs/images/report-type.jpg" alt="墨型和比例"></td>
<td width="50%"><img src="docs/images/report-atlas.jpg" alt="十六种墨型"></td>
</tr>
</table>

四组字母，每组两边各有一个比例：

| 字母 | 看什么 |
|---|---|
| W 先看整张 / D 先看局部 | 整图回应占多少，分界 40% |
| M 往里想 / C 往外感 | 人的动作对颜色加权 |
| F 简笔 / B 浓墨 | 纯形状回应占多少，分界 45% |
| P 常见 / U 少见 | 少见或偏离的形状占多少，分界 1/3 |

**墨型是这个项目编的一套记法**，方便记住这次看图的方式。W、D、M、C、F、U 借自罗夏的记号，B 是我们自己的叫法，这里的 P 也不是罗夏的 Popular。比例按我们定的分界线换算，50% 就是正好在分界线上，不是回应的原始占比，只有 M/C 是字面占比。这些都没有科学验证，下次做可能不同，也不能用来判断别人。

每一型的文案是固定的，和星座一样读着舒服，别把它当结论。想核对的话，看信和水面下：里面引用的原话都核对过，都是你说的。

### 分享

<p align="center"><img src="docs/images/share.jpg" alt="分享卡" width="360"></p>

报告末尾有一张分享卡和一段可以改的话，写测出来是哪一型，加上这个仓库的链接。卡片上还有四组比例和一张由你的圈画生成的墨迹。你说过的话、带来的问题、父母题、昵称和年龄都不会出现在里面。

这些报告截图来自一次真实的 Codex 验收，报告是它自己写的，测试者「阿禾」是虚构的，由脚本扮演。界面截图来自另一位虚构的测试者「小林」。

## 数据

每次测试是一个目录，在 `~/.rorschach/sessions/<时间>/`。

| 文件 | 内容 |
|---|---|
| `trace.jsonl` | 无损事件流，每句话、每一笔、每次转动和缩放，带毫秒时间 |
| `protocol.json` | 分层整理后的完整记录：会话 → 十张图 → 每次呈现、手势、回应、询问、编码，再加四个问题和结构摘要 |
| `report.html` | 报告 |
| `transcript.md` | 对话文字稿 |

`protocol.json` 按 [`schema/protocol.schema.json`](rorschach/schema/protocol.schema.json) 校验，字段说明在 [`references/data-model.md`](rorschach/references/data-model.md)。在 skill 目录里运行 `node scripts/ror.mjs validate <文件>`，可以检查一份数据有没有被改坏。

## 它能说什么，不能说什么

罗夏测验本身有争议。Mihura 等人 2013 年的元分析发现，罗夏变量和外部观察的相关是 r = .27（k = 770），和自评问卷只有 r = .08（k = 386），认知和知觉类指标证据最强，自我中心指数、孤立指数这类证据最弱。所以报告按指标类别限制置信度上限，你觉得「不像我」很正常。

报告写好后要过校验门。下面这些会被拒绝，退回重写：

- 引文不是你的原话，证据只来自一张图
- 诊断词和放在谁身上都成立的话
- MBTI、智商、依恋类型、百分位、匹配度、患病概率、薪资
- 对你父母和童年的判断（校验靠句式匹配，换个说法可能漏过，所以 skill 里也要求不写）
- 拿年龄、学历、职业下判断
- 把猜测写成事实，比如「你潜意识里」「说明你」
- 说教和鸡汤，比如「你应该」「相信自己」
- 脚本找到的重要线索既没写也没说明为什么不用
- 引用你在安全暂停里说的话，或写出危险的词

**它读不出潜意识。** 没有证据表明一次罗夏能做到这一点。「水面下」写的是留下痕迹的东西和一种猜想，每条都带另一种解释，由你决定算不算数。

听到危险信号时，测试会暂停，给出 12356，等你明确想继续才接着做。关键词抓不全，所以 Codex 也要自己判断，它觉得不对也可以暂停。安全暂停里说的话只留在本机的 `protocol.json`，不进报告文件。

### 没有核实的部分

这个项目由 AI 编码，**没有持证评估者复核**，也没有和原版手册对照。

| 内容 | 状态 |
|---|---|
| Mihura 2013 的数字 | 核对过论文摘要 |
| 每张两到三个回应、提示和收走的规则（R-PAS） | 部分核实 |
| 12356 热线 | 来自搜索摘要 |
| 学历和年龄与回应的关系（Meyer 等 2015、R-PAS 青少年常模） | 来自搜索摘要，没有读到全文。职业没有查到直接证据 |
| 顺序分析和主题分析，「水面下」的线索来源（Exner、Schafer） | 来自记忆 |
| 十六墨型的名字、文案和分界线 | 我们自己定的，没有验证 |
| 综合系统开场语、就座方式、Z 值表、WSum6 权重、Popular 清单、D 分表、旋转记号 | 来自记忆，没有对照原手册 |
| 常模 | 没有取到，所以报告不打印任何和常模比较的数字。形状常不常见由 AI 按记忆里的编码表判断，墨型里的「常见」「少见」也来自这里 |
| AI 编码的准确度 | 用一个虚构案例和一份手工答案比过 19 条，跑了四轮：位置 18–19 条一致，形状质量 12–15 条，内容 10–11 条。细粒度数字不要当真 |

### 没有测过的环境

真实麦克风的 VAD 阈值、真实触屏、Safari、非 Pro 的 ChatGPT 配额。Claude Code 等其他能运行 shell 的 agent 大概也能用，但只完整跑过 Codex。有问题欢迎提 issue。

## 隐私

- 记录只存在本机，代码里没有任何上传和统计。
- 你说的话、填的基本信息和报告内容会经过你正在用的模型服务；用 Codex 实时语音时，声音也会发给 OpenAI。起始页会告诉你这一点。
- 测试页面还开着时，报告底部可以删除这次记录，这会删掉整个目录。之后要删，直接删 `~/.rorschach/sessions/<时间>/`。下载过或发给别人的报告，要你自己管。

## 开发

```sh
cd rorschach/scripts
node --test test/scoring.test.mjs test/protocol.test.mjs test/server.test.mjs
```

没有依赖。服务是一个 Node 文件，靠 HTTP 和 SSE 和页面通信，`ror` 命令行让 agent 通过文件和服务对话。语音模型只照读台词，判断都在外层 agent 手里。视觉规范在 [`DESIGN.md`](DESIGN.md)。

## 来源与授权

- 代码和文档：[MIT](LICENSE)。不在授权内的部分见 [NOTICE](NOTICE)。
- 十张图版：Hermann Rorschach 1921 年发表。Wikimedia Commons 把这套图版标为 Public Domain Mark（[示例](https://commons.wikimedia.org/wiki/File:Rorschach_blot_04.jpg)）。各地版权判断可能不同，商用前请自行确认。
- 作者二维码不在 MIT 授权内。fork 时请替换或删除 `rorschach/app/author-qr.png`，并修改 `rorschach/app/index.html` 和 `rorschach/scripts/lib/report.mjs` 里的名字。删掉图片后，报告里的作者卡会自动消失。
- 分享卡和分享文字里的仓库地址在 `rorschach/scripts/lib/report.mjs` 的 `PROJECT`，二维码是 `rorschach/app/repo-qr.png`，fork 时一起改。
- README 的封面和流程两张图由 Codex 的 Image Gen 生成，其余截图是真实界面。

## 作者

<img src="rorschach/app/author-qr.png" alt="孙务远的微信二维码" width="132" align="left" hspace="16">

**孙务远**

做这个测试的人。聊这个工具可以加我微信。

心理咨询请找专业的人。

<br clear="left">
