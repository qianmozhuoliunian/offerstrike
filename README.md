<p align="center"><img src="public/assets/offerstrike-icon.png" width="96" height="96" alt="面试突击品牌图标"></p>

# 面试突击 · OfferStrike

**收藏夹替不了你上场。锁定岗位，直接开练。**

OfferStrike 是以真实面经为起点的个性化面试准备工作台。按目标岗位找原帖，核对证据后收题，围绕自己的回答持续追问，再根据练习表现安排下一轮训练。

**锁定岗位 → 搜索面经 → 核对原文收题 → 作答与追问 → 更新下一轮计划**

Vue 3 · FastAPI · SQLite · Electron

## 能做什么

| 模块 | 实际流程 |
| --- | --- |
| Research · 找题与核对 | 按岗位、公司和时间搜索公开面经，读取支持来源的正文，提取带原文摘录的候选题，由你确认入库。 |
| Interview · 作答与追问 | 围绕一道题连续练习，保留自然语言点评，记录有回答依据的正确点、错误、遗漏与未验证项，每题最多 8 轮。 |
| Career · 安排下一轮 | 结合岗位要求、题库和练习历史推荐下一步，展示理由与历史依据；缺题时创建补搜任务，确认后执行。 |

同时支持离线作答、草稿恢复、面试复盘、JSON 备份与恢复。三题串练和简历能力线索提取为实验功能。

## 快速开始

需要 **Node.js 22.13+** 和 **Python 3.10+**。在项目根目录运行，以下为 Windows / PowerShell 命令。

```powershell
npm ci
python -m venv .venv
.venv/Scripts/python.exe -m pip install -r backend/requirements.txt
npm start
```

`npm start` 会构建 Vue 并启动 FastAPI。打开终端给出的**完整本机链接**，链接含本次访问凭证，请勿分享。默认端口为 `8010`。

Windows 桌面开发与打包见[桌面版指南](docs/desktop-and-demo.md)。旧 Node 入口可通过 `npm run start:legacy` 回退，旧题库、历史和备份继续兼容。

### 按需配置搜索和 AI

网页工作台从项目根目录 `.env` 读取配置，可参考 [.env.example](.env.example)。修改后重启服务。

| 使用方式 | 需要的配置 |
| --- | --- |
| 手动收题、保存回答、自评与规则推荐 | 无需 API Key |
| 搜索公开面经 | `TAVILY_API_KEY` 或 `EXA_API_KEY`，至少配置一个 |
| AI 提题、点评与追问 | `AI_API_KEY`、`AI_MODEL`，按供应商设置 `AI_BASE_URL`，使用兼容 Chat Completions 的服务 |

桌面版在「设置与备份」中单独配置服务，密钥由系统加密保存。外部 API 由你选择的供应商计费。

### 只想先体验

仅需 Node.js，在项目根目录运行：

```sh
npm run demo:preview
```

静态体验使用固定样例和预置点评，无需 Python 或 API Key，刷新后清空本次输入。

## 第一次怎么练

1. 保存并确认目标岗位，填写需要准备的知识主题。
2. 搜索公开面经，打开原帖核对题目、公司和岗位，再确认收题。
3. 从题库开始练习，提交回答并查看点评，按需继续追问或结束总结。
4. 打开「备战计划」，查看下一题及推荐依据；缺题时确认补搜任务。

## 当前边界与隐私

- 自动正文读取目前主要支持**牛客和博客园**，其他平台提供搜索线索或由用户粘贴原文。搜到链接不代表已经读到正文或提取到可信题目。
- AI 点评和归属判断仍可能出错，需要核对证据；单次回答不生成永久的「已掌握」标签。自动化测试通过不代表真实模型评价准确，已有结果见[迁移验收](docs/specs/vue-fastapi-migration.md)与[业务质量评估](docs/business-quality-evaluation-2026-11-17.md)。
- 题库、回答和复盘保存在本机，SQLite 与导出的 JSON **未做整库加密**。使用搜索或 AI 时，界面披露的相应内容会发送给所配置的服务，详见[数据流向](docs/usage.md#外部服务配置与数据流向)。真实密钥与个人备份不要提交到仓库。
- 当前面向**本机单用户**。对外演示使用独立的 `dist/demo/`，完整工作台不应直接暴露公网。[安全说明](SECURITY.md)

## 开发与文档

[使用与配置](docs/usage.md) · [运行架构](docs/runtime-architecture.md) · [开发与测试](CONTRIBUTING.md) · [产品设计](DESIGN.md)

原创代码采用 [MIT 许可](LICENSE)，第三方来源与许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。外部面经内容归原作者所有。
