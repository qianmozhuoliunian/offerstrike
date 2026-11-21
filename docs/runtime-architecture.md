# 本机工作台的运行架构

更新于 2026-11-21。默认入口为 Vue 3、Python/FastAPI 与 SQLite，Electron 桌面使用同一 Python 后端。

## 入口与目录

`npm start` 先构建 `frontend/`，再由 `scripts/start-workbench.mjs` 启动 `backend.run`。Python 提供 `dist/vue` 静态资源和同源 `/api/` 接口，不代理旧 Node 业务。

`frontend/src/App.vue` 管理岗位、导航及选题交接。Vue 组件分别承载岗位、来源、Research、练习、Career、复盘和设置，网络请求集中在 `api.js`。界面不接收外部服务密钥。

旧 `server.js`、`public/` 与 `src/` 保留为 `npm run start:legacy` 回退入口及兼容测试。原 `src/research/skills` Markdown 提示词由 Python 共用。静态 `demo/` 与真实资料隔离。

## 后端职责

| 模块 | 职责 |
| --- | --- |
| `backend/app.py` | 组装依赖、工作区、岗位及题库 CRUD |
| `backend/security.py` | 本机 Host、Origin、访问凭证、JSON 大小及响应头保护 |
| `backend/database.py` | SQLite 连接与事务迁移 |
| `backend/research/` | Tavily / Exa 搜索、原帖读取、证据和归属核对、人工确认 |
| `backend/ai.py` | 模型传输、超时、用量与安全错误提示 |
| `backend/practice.py` / `evaluation.py` | 草稿、8 轮对话、回答证据、结构化校验、离线作答与历史 |
| `backend/career.py` / `recommendation.py` / `knowledge.py` | 能力历史、别名白名单与可解释规则推荐 |
| `backend/training_tasks.py` | 持久补题任务、租期、取消、重复执行与训练完成 |
| `backend/backup.py` / `misc.py` | v1 备份互通、面试复盘与独立简历能力摘录 |

Research 直接调用配置的搜索服务，默认最多 4 次搜索、2 次原帖读取、3 次模型调用和 75 秒。支持自动正文读取的来源仍限牛客与博客园，其他平台的搜索线索不等于已获取正文。

单题最多 8 轮，问题最多 2000 字、回答最多 10000 字，对话输入合计最多 30000 字，超限提示调整。结构化校验失败保留可用点评并明确降级；点评整体格式失败不保存成功记录。幂等编号与事务防止重复回答和重复确认。

Career 规则推荐无需额外模型调用，读取有依据的能力历史。训练任务状态为 proposed、searching、review、ready、completed、failed 或 cancelled，搜索租期 80 秒。新题经过证据处理和用户核对后入库，再由新练习更新推荐。

## 数据兼容与安全

沿用 SQLite `user_version=3` 的既有表和主键，在事务中升级旧表，高于当前版本时拒绝启动。旧来源摘录不自动提升为已确认题目。JSON v1 保留原字段，增加可选 `training_tasks` 扩展；旧备份可导入，旧 Node 导入器忽略扩展。

导入先验证再事务合并，已有记录优先。题目、回答证据、追问链、草稿和任务关联分别验证，冲突关联不会改绑到另一题。导入请求最多 30 MB，其他 JSON 写请求最多 400 KB。

网页读取根 `.env`，系统环境变量优先，完整访问链接包含每次启动的临时凭证。桌面使用受限预加载与专用请求头，继续使用 `%APPDATA%\OfferPilot\workbench` 和系统加密的 `services.enc`，不读取根 `.env` 或继承系统服务密钥。

Vue 草稿串行保存。桌面退出前请求等待保存，最长等待 1.8 秒；服务无法连接等异常情况下无法保证未提交草稿已落盘，应关注页面保存错误。三题模拟计数仅在当前页面，刷新结束本场，已保存练习保留。

## 验证

`npm run fastapi:test` 覆盖原生 API、规则、迁移、旧 Node SQLite 与 JSON 双向兼容。`npm test` 保留旧业务回归。`npm run vue:test-ui` 使用真实 Vue 页面、FastAPI 和临时 SQLite，外部模型与搜索为模拟响应。

`npm run desktop:test` 检查生产桌面引导、加密配置、退出草稿与重启恢复。第三步需要先构建 Windows 应用目录，使用其中的独立 Python 后端，属于本机打包引导验证，未代替全新电脑安装验收。

真实 Tavily / DeepSeek 调用与模拟测试单列于[迁移规格](specs/vue-fastapi-migration.md)。真实调用验证了链路，也暴露模型可能把未要求内容判为遗漏的问题；引用定位和 Schema 合法不能证明语义判断正确。
