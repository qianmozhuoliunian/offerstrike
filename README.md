<p align="center"><img src="public/assets/offerstrike-icon.png" width="96" height="96" alt="面试突击品牌图标"></p>

# 面试突击 · OfferStrike

**收藏夹替不了你上场。锁定岗位，直接开练。**

面试官追问时，光是「这题我看过」可不够。用 OfferStrike 把公开面经变成自己的题库：对着原帖收题，亲自答一遍，卡壳的题下次接着练。

**锁定岗位 → 找公开面经 → 核对原帖收题 → 作答并自评 → 按推荐回练**

## 先练一题

需要 Node.js 22.13+，推荐 Node.js 24。在项目目录运行：

```sh
npm ci --omit=dev
npm run demo:preview
```

打开终端提示的地址，用样例体验「核对原帖 → 作答 → 自评 → 推荐」。无需 API 密钥，刷新即清空本次输入。

想保存自己的题库和练习记录？按以下步骤启动完整工作台。链接带访问凭证，请勿分享。

## Vue 与 FastAPI 工作台

默认入口已使用 Vue 3 与原生 Python/FastAPI，提供岗位、资料库、面经搜索、证据确认、多轮练习、结构化评价、备战计划、补题任务、复盘、三题模拟与备份。旧 Node 入口通过 `npm run start:legacy` 保留，供回退。

需要 Python 3.10+ 和项目开发依赖。在项目根目录运行以下 Windows 命令。

```powershell
npm ci
python -m venv .venv
.venv/Scripts/python.exe -m pip install -r backend/requirements.txt
npm start
```

打开启动窗口给出的完整本机链接。新版默认使用现有开发资料目录，根目录 `.env` 中的 `INTERVIEW_DATA_DIR` 可以指定其他目录。验证时可运行 `.venv/Scripts/python.exe -m backend.run --data-dir data/migration-check`，使用独立资料。

接口与旧库兼容测试运行 `npm run fastapi:test`，先安装测试依赖 `.venv/Scripts/python.exe -m pip install pytest httpx`。页面流程验证运行 `npm run vue:build` 后运行 `npm run vue:test-ui`，使用临时资料，并在 `data/vue-fastapi-smoke` 输出截图。迁移顺序及验收结果见[迁移规格](docs/specs/vue-fastapi-migration.md)。

## 用自己的题库实战

1. 设置目标岗位，再搜索公开面经，或直接录入已有原帖链接。
2. 核对原文，添加一道题并选择「保存并练习」。
3. 写下回答，点击「仅保存作答」，自评「需要再练」或「比较熟悉」。
4. 打开「备战计划」，看看哪题该回练，以及为什么。

手动收题、作答、自评和推荐无需密钥。应用内搜索需配置 Tavily 或 Exa；AI 提题、点评与追问需配置兼容 Chat Completions 的模型服务，结果需人工核对。

## 数据与初版范围

题库、作答和复盘保存在本机，可在设置页导出 JSON 备份。使用搜索或 AI 时，相应输入会发送给你配置的服务；具体范围见[数据流向](docs/usage.md#外部服务配置与数据流向)。

v0.1.0 为本机单用户试用版。对外分享请使用独立静态体验页。Windows 版及构建方式见[桌面与体验页](docs/desktop-and-demo.md)。

[完整使用与配置](docs/usage.md) · [运行架构](docs/runtime-architecture.md) · [贡献与检查](CONTRIBUTING.md) · [首发说明](docs/releases/v0.1.0.md)

项目原创代码采用 [MIT 许可](LICENSE)。第三方依赖遵循各自许可，引用的外部面经归原作者所有。
