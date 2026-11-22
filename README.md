<p align="center">
  <img src="public/assets/offerstrike-icon.png" width="108" height="108" alt="面试突击品牌图标">
</p>

<h1 align="center">面试突击 · OfferStrike</h1>

<p align="center">
  <strong>别再盲刷题，针对下一场面试出击。</strong>
</p>

<p align="center">
  从可核对的真实面经收题 · 围绕真实作答连续追问 · 系统归因推荐下一题
</p>

<p align="center">
  <a href="https://vuejs.org/"><img src="https://img.shields.io/badge/Vue-3.5-42b883?logo=vuedotjs&logoColor=white" alt="Vue 3"></a>
  <a href="https://fastapi.tiangolo.com/"><img src="https://img.shields.io/badge/FastAPI-0.115+-009688?logo=fastapi&logoColor=white" alt="FastAPI"></a>
  <a href="https://www.sqlite.org/"><img src="https://img.shields.io/badge/SQLite-Local--First-003B57?logo=sqlite&logoColor=white" alt="SQLite"></a>
  <a href="https://www.electronjs.org/"><img src="https://img.shields.io/badge/Electron-Desktop-47848F?logo=electron&logoColor=white" alt="Electron"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License MIT"></a>
</p>

<p align="center">
  <a href="#quick-demo">⚡ 一行命令体验</a>　·　
  <a href="#full-install">🛠 完整安装</a>　·　
  <a href="#workflow">🗺 核心流程</a>　·　
  <a href="#config">🔑 服务配置</a>　·　
  <a href="docs/usage.md">📖 使用文档</a>　·　
  <a href="LICENSE">📄 MIT 许可</a>
</p>

---

> **你收藏夹里的三百篇面经，一篇都不会替你上场。**

大多数求职者的备考困境：**搜面经 → 收藏 → 看了两行合上 → 焦虑 → 考前临阵磨枪**。

面试官一深挖：“你刚提到用重排模型，如果延迟超标怎么权衡？怎么判断是召回阶段掉点还是排序阶段掉点？” 瞬间卡壳。

OfferStrike 换了一条路：**找到真实面过的题，逼自己打字答出来，系统追问你的盲点，然后告诉你下一题是哪道、为什么是它。**

- **真实可考**：每道题均可直通原帖正文与原文摘录核对，拒绝 AI 凭空捏造。
- **深度追问**：拒绝廉价点赞与泛泛而谈，围绕回答进行最多 8 轮硬核追问，抓出漏洞与未验证假设。
- **归因推荐**：结合岗位要求、历史答题依据与自评表现推荐下一题，讲清“为什么练这道”。
- **本地优先**：题库、草稿与练习记录保存在本机 SQLite，零 Key 即可完整离线使用。

---

<p align="center">
  <img src="public/assets/interview-discover.png" alt="Research 界面：搜索面经与核对原文" width="800">
  <br><sub><b>Research</b> — 按岗位搜索公开面经，读取原帖正文，逐题核对原文摘录后确认收题</sub>
</p>

<p align="center">
  <img src="public/assets/interview-practice.png" alt="Interview 界面：作答与追问" width="800">
  <br><sub><b>Interview</b> — 提交回答，围绕同一道题连续深度追问，指出正确依据与遗漏关键点</sub>
</p>

<p align="center">
  <img src="public/assets/interview-planning.png" alt="Career 界面：备战计划与下一题推荐" width="800">
  <br><sub><b>Career</b> — 结合岗位和练习历史推荐下一题，展示明确理由与来源依据；缺题时自动补搜</sub>
</p>

---

## 看一次完整练习

> **真实场景演练**（题目与公司用于展示产品逻辑，实际练习以收录资料为准）

**目标**：准备大模型 / AI 应用开发岗位，今晚专项复习 **RAG（检索增强生成）**。

### 1. 从真实面经收题入库
系统检索到一篇头部互联网大厂的校招面经，自动提取原帖正文与候选题。打开原文链接比对，确认面经作者第一人称自述属实，点击确认收录入库。

### 2. 真实作答与多轮追问
> 🙋 **我的回答**：调大 top-k，多召回一些候选块，然后再用重排模型（Reranker）筛选高分段落。
>
> 🤖 **系统追问**：怎么客观评估问题出在召回侧还是生成侧？如果召回块已经包含答案上下文，但大模型最终回复依然错误，你会优先排查什么？

我继续补充了 `Recall@K` 指标评估方案，以及检查上下文窗口位置截断、Ground-truth 逐块标注等思路。

系统给出结构化反馈：
- ✅ **正确点**：准确给出了两阶段检索（召回 + 重排）架构，并说明了利用 Recall@K 隔离检索瓶颈的思路。
- ⚠️ **遗漏项**：未讨论长文本“迷失在中间”（Lost in the Middle）现象对生成质量的影响，未提及向量检索相似度阈值对召回密度的作用。
- 📝 **自评标记**：我选择「需要再练」。

### 3. 备战计划智能推荐
系统自动更新能力地图并推荐下一题：
> 📌 **下一题推荐**：**向量检索中相似度截断阈值该如何设定与调优？**
>
> 💡 **推荐理由**：同属「检索质量调优」主题。你在上一题中遗漏了相似度阈值对召回密度的影响，该题直接针对该盲点进行专项强化。
>
> 🔗 **题目来源**：某厂 2024 年大模型应用实习面经（牛客网原帖）。

这就是完整闭环：**收题有据可查 → 追问直击漏洞 → 推荐说明因果**。

---

## ⚡ 只想先看看效果 <a id="quick-demo"></a>

只需要 **Node.js 22.13+**，无需安装 Python 环境，无需配置任何 API Key：

```sh
npm run demo:preview
```

执行后将自动启动隔离预览页。使用内置真实面经样例与预置交互点评完整走完流程。刷新即重置，不写入任何真实本地数据。

---

## 🛠 完整安装与启动 <a id="full-install"></a>

完整工作台需要 **Node.js 22.13+** 和 **Python 3.10+**。

### 1. 克隆与安装依赖

**Windows (PowerShell)**：
```powershell
npm ci
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r backend/requirements.txt
npm start
```

**macOS / Linux (Bash)**：
```bash
npm ci
python3 -m venv .venv
.venv/bin/pip install -r backend/requirements.txt
npm start
```

### 2. 打开工作台

`npm start` 将自动构建 Vue 前端并启动 Python/FastAPI 服务。

启动成功后，终端将输出带有**一次性访问凭证**的本机链接：
```
http://127.0.0.1:8010/#access=...
```
请复制该完整链接并粘贴至浏览器中打开。
> 访问凭证由服务端动态生成，用于保障本机单用户环境下的 API 调用安全，请勿将完整链接分享给他人。默认端口为 `8010`，若遇端口冲突可通过 `npm start -- --port 8011` 指定其他端口。

### 3. 桌面客户端开发与打包

需要使用 Electron 独立客户端时，可运行：
```sh
npm run desktop
```
打包为独立安装包及配置方式见 [桌面版与体验页指南](docs/desktop-and-demo.md)。

---

## 🔑 配置搜索与 AI 服务 <a id="config"></a>

复制根目录 [.env.example](.env.example) 为 `.env`，按需配置外部能力。修改后重启服务即可生效。

| 准备阶段 / 使用场景 | 对应功能 | 必需配置 |
| :--- | :--- | :--- |
| **零 Key 离线模式** | 手动收题、离线打字作答、自主标记自评、本地规则归因推荐、全量 JSON 备份与恢复 | **无需任何 Key**，断网可用 |
| **全网面经检索** | 搜索牛客、掘金、知乎、博客园等平台的公开面经正文与线索 | 配置 `TAVILY_API_KEY` 或 `EXA_API_KEY`（配任意一个即可） |
| **AI 深度追问与点评** | 自动提取原帖候选题、8 轮深度追问、作答反馈、岗位要求解析 | 配置 `AI_API_KEY`、`AI_MODEL` 与 `AI_BASE_URL` |

### 模型兼容性
`AI_BASE_URL` 支持所有兼容 **OpenAI Chat Completions** 协议的推理服务，已适配并验证：
- **国产模型**：DeepSeek (V3 / R1)、通义千问 (Qwen)、月之暗面 (Moonshot / Kimi) 等
- **国际主流**：OpenAI (GPT-4o / GPT-4o-mini)、Anthropic Claude (通过中转网关)
- **本地模型**：Ollama、vLLM、LM Studio 等本地推理框架

> 外部 API 费用由所选供应商计费。密钥仅保留在本地 `.env` 或系统加密区，**绝不会上传至第三方服务器或提交至 Git 仓库**。

---

## 🗺 核心流程与功能 <a id="workflow"></a>

```
锁定岗位 ──> 检索公开面经 ──> 核验原文摘录 ──> 确认收录题库
                                                  │
    ┌─────────────────────────────────────────────┘
    ▼
真实作答 ──> 8轮深度追问 ──> 结构化点评与自评
                                  │
    ┌─────────────────────────────┘
    ▼
备战计划 ──> 归因推荐下一题 ──> (缺少题目时自动生成补搜任务)
```

| 模块 | 功能说明 |
| :--- | :--- |
| **Research · 找题与核实** | 支持按目标岗位、公司及发布时间搜索公开面经；自动读取并解析支持站点的原帖正文（现阶段重点支持牛客网与博客园）；智能提取候选问题并关联原文摘录；用户人工逐题核对后入库。 |
| **Interview · 作答与追问** | 真实打字练习；单题支持最多 8 轮渐进式深度追问；输出包含正确依据、漏洞遗漏与思考方向的结构化点评；支持草稿自动暂存、断网离线作答与主动作答自评（“需要再练” / “比较熟悉”）。 |
| **Career · 备战规划** | 结合目标岗位要求、历史答题记录与自评状态自动规划复习重点；给出明确的归因推荐理由与题目来源；当题库储备不足时自动生成带租期保护的定向补搜任务。 |
| **Tools · 复盘与备份** | **面试复盘**：录入真实面试的被问问题与实战复盘，支持一键将实战真题沉淀至题库；<br>**三题串练**：模拟实战多题节奏（实验特性）；<br>**备份恢复**：全量 JSON 导出与跨版本安全合并导入，不覆盖已有冲突。 |

---

## ⚠️ 边界与隐私声明 <a id="privacy"></a>

- **来源可追溯原则**：自动正文提取当前重点支持**牛客网与博客园**，其他平台作为搜索线索或由用户手动粘贴。搜到链接不等于已读到正文，读到正文不等于提取到可信题目。严禁将博主整理帖或 AI 生成内容混淆为真实第一人称面经。
- **AI 会出错，人工核对是底线**：AI 点评、题目提取与岗位归属判断均存在幻觉可能，必须以原文证据为准。单次作答不贴永久“已掌握”标签；未评估或未练习不等于用户不会。自动化测试通过不代表真实模型在所有场景下评价准确（详见 [迁移验收记录](docs/specs/vue-fastapi-migration.md) 与 [业务质量评估](docs/business-quality-evaluation-2026-11-17.md)）。
- **本地优先与数据安全**：题库、作答记录、复盘历史保存在本地 SQLite 数据库中。SQLite 与导出的 JSON 备份文件**未做整库加密**，请妥善保管个人文件。仅在触发搜索或 AI 服务时，界面披露的必要文本才会发送给你配置的服务商，详见 [数据流向说明](docs/usage.md#外部服务配置与数据流向)。
- **面向本机单用户**：完整工作台设计为本机单用户工具，不应直接暴露至公网。对外演示请使用独立的静态构建产物 `dist/demo/`。详见 [安全说明](SECURITY.md)。

---

## 📚 文档与参考 <a id="docs"></a>

- [📖 完整使用与配置指南](docs/usage.md)
- [🏗️ 运行架构与代码结构说明](docs/runtime-architecture.md)
- [🖥️ 桌面客户端与体验页开发](docs/desktop-and-demo.md)
- [🎯 产品设计规范 (DESIGN.md)](DESIGN.md)
- [📋 术语与业务概念表 (GLOSSARY.md)](GLOSSARY.md)
- [🤝 参与贡献与测试指南](CONTRIBUTING.md)
- [🔒 安全策略与报告流程](SECURITY.md)

原创代码采用 [MIT 许可证](LICENSE) 发布。第三方组件与依赖许可参见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。外部面经内容版权归原作者所有。
