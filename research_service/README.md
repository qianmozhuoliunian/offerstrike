# FastAPI 面经研究接口

使用 Python 3.11+。在项目根目录安装依赖：

```powershell
python -m venv .venv
& .\.venv\Scripts\python.exe -m pip install -r research_service/requirements-dev.txt
```

两个终端都从项目根目录运行，共用已有 `.env` 中的 `TAVILY_API_KEY` / `EXA_API_KEY`。两个进程需看到同一组搜索配置；实际向供应商鉴权的是 Python。

```powershell
# 终端 1：启动 FastAPI，只监听本机
& .\.venv\Scripts\python.exe -m uvicorn research_service.main:app --host 127.0.0.1 --port 8091 --env-file .env
```

```powershell
# 终端 2：让 Node 将检索交给 FastAPI
$env:RESEARCH_SERVICE_URL = 'http://127.0.0.1:8091'
npm start
```

浏览器打开 Node 终端显示的地址。搜索成功时页面提示「本次由 Python 研究服务执行检索」。可打开 [FastAPI 接口文档](http://127.0.0.1:8091/docs)，或用 `Invoke-RestMethod http://127.0.0.1:8091/health` 查看配置的供应商；健康检查不会消耗搜索额度。也可把 `RESEARCH_SERVICE_URL` 放进 `.env`；若要切回 Node 检索，请移除环境变量与 `.env` 中的该项，再重启 Node。Python 停止时不会偷偷切回 Node 再次对外请求。

`POST /v1/retrieve` 执行一次检索，接收供应商、岗位、公司、站点、时间和固定检索词。只返回网页线索，不读取原帖，也不接触 SQLite。Node 负责决定何时补搜，并在返回网页前做过滤、去重和可选的 AI 相关性判断。

```powershell
& .\.venv\Scripts\python.exe -m pytest -q research_service
npm test
```
