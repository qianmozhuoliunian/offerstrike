# 桌面版与公开体验页

网页版用于演示，Windows 应用是日常备战的完整入口。两端共用复习推荐规则；公开版只加载固定样例，当前页面的回答与自评不发送也不保存。现有本地网站和 `npm start` 继续可用。

## 预览与发布网页

```powershell
npm ci
npm run demo:preview
```

打开 `http://127.0.0.1:8090`，按「核对原帖 → 练习和自评 → 看推荐」体验。选择「需要再练」与「比较熟悉」会得到不同推荐；点评明确标注为预置示例。

运行 `npm run demo:build` 后，只将 `dist/demo/` 交给静态托管。无需配置 API、数据库或密钥。若要在网页提供下载，先将 `OfferPilot-Setup.exe` 放入 `dist/demo/desktop/`，再执行 `npm run demo:build -- --desktop-download`。未启用下载时，页面不会显示下载链接。不要把项目根目录或本机 Node 工作台部署到公网。

## Windows 桌面试用

在 Windows 运行 `npm run desktop:build`，产物位于 `dist/windows/`：

- `OfferPilot-Setup.exe`：当前用户安装程序。
- `OfferPilot-0.1.0-win.zip`：便携程序，先解压整个目录，再双击 `OfferPilot.exe`。

两种方式都自带运行时。当前为未签名的 Windows x64 测试版，不提供自动更新。资料位于 `%APPDATA%\OfferPilot\workbench\interview.sqlite`，安装路径和项目源码目录均不保存这份数据。

首次使用可先在原工作台导出 JSON，再到桌面版「偏好与状态 → 导入备份」。导入只做合并，原数据库仍在原处。原岗位导入后如显示待核对，按现有流程确认后即可搜索。桌面应用关闭时会先尝试保存当前草稿，再退出本机后端；异常断电或强制结束进程仍可能丢失尚未保存的输入。

在桌面版「搜索和 AI 设置」填写各服务密钥、模型和地址，保存后重启。密钥使用当前系统账号的加密存储，不回显、不进备份或打包产物。桌面版快速搜索和深度研究均使用 Node 路径，无需 FastAPI。无网络或无模型密钥时，仍可管理题库、恢复草稿、仅保存作答并自评；主动补点评只发送本次题目和回答。
