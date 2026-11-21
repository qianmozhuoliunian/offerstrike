# 桌面版与公开体验页

静态体验页使用固定样例，回答和自评刷新即清空。要保存自己的题库，用 Windows 桌面版或 `npm start` 启动本机工作台。

## 预览与发布网页

```powershell
npm ci --omit=dev
npm run demo:preview
```

打开终端给出的地址。请使用虚构回答，点评为预置示例。

对外发布时，运行 `npm run demo:build`，只托管 `dist/demo/`。平台若不读取 `_headers`，请按该文件设置响应头。想提供 Windows 下载，先构建安装包，再运行 `npm run demo:build -- --desktop-download`。

## Windows 桌面试用

在 Windows 安装 Node.js 22.13+、Python 3.10+，在项目根目录构建：

```powershell
npm ci
python -m venv .venv
.venv/Scripts/python.exe -m pip install -r backend/requirements-build.txt
npm run desktop:build
```

开发启动使用 `npm run desktop`，需要先安装 Python 运行依赖。构建会将 Vue 静态页面和独立 Python 后端一起打包，安装后的运行无需另装 Node 或 Python。产物位于 `dist/windows/`：

- `OfferStrike-Setup.exe`：当前用户安装程序。
- `OfferStrike-0.1.0-win.zip`：便携程序，先解压整个目录，再双击 `OfferStrike.exe`。

两种方式均自带运行时。Windows x64 试用包未签名，无自动更新。桌面版沿用 `%APPDATA%\OfferPilot\workbench\`，更名无需迁移数据。

从网页工作台迁移时，先导出 JSON，再从桌面版「设置与备份」选择文件、预览并合并。若旧岗位显示待核对，请确认后再搜索。

清空资料时，先退出应用，再删除数据目录里的 `interview.sqlite` 及同名辅助文件，并单独处理已导出的 JSON。`services.enc` 是加密的服务配置，删除后需重新配置。

可在「设置与备份」填写密钥、模型和地址，保存后重启。密钥由系统加密保存，不进入备份；已配置密钥留空保留，勾选清除才移除。桌面服务只使用自身加密配置，不读取网页 .env 或继承系统中的服务密钥。无需配置也能整理题库、作答和自评；各功能发送的数据见[使用指南](usage.md#外部服务配置与数据流向)。
