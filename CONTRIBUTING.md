# 一起修改

这是免费开源的 Codex 桌面伴侣。欢迎分叉成自己的角色、台词和界面，也欢迎提交 Pull Request（合并请求，PR）。代码和文档采用 MIT；素材范围见 [来源与许可](PROVENANCE.md)。

## 开发

需要 Node.js 24 或更新版本。运行时的 TOML 解析器已放在 vendor 中，基础开发不需要安装依赖。

```powershell
npm test
npm run check
node scripts/diagnose.mjs
```

最后一条只检查本机官方 Codex 程序；加 `--live` 才查询已登录账号的额度，不进行模型生成。

桌面运行需要 Electron：`node scripts/install-desktop.mjs` 会下载固定版本到独立数据目录。完整注册使用根目录的 `安装插件.cmd`。打包运行 `npm run pack`，需要 Python 3.10+（Windows 安装时包含 Python Launcher，命令为 py）。也可以直接运行 `python scripts/build-release.py`。

## 修改入口

| 想改什么 | 从这里开始 |
| --- | --- |
| 默认角色 | `assets/rin-default.png`，或在挂件界面导入自己的角色 |
| 默认台词 | `themes/rin/quotes.json`，普通 JSON 字符串数组 |
| 气泡和额度卡 | `desktop/ui/account-view.js` |
| Codex 程序发现 | `runtime/codex-location.mjs` |
| 额度请求与刷新 | `runtime/quota-rpc.mjs`、`runtime/quota-live.mjs` |
| 会话用量 | `runtime/insights-worker.mjs`、`runtime/session-card-data.mjs` |

一个 PR 尽量解决一个明确问题，说明触发条件、改后行为和实际验证结果。小改动不需要长设计文档。新逻辑或真实缺陷补一两个有效测试即可；不要求覆盖率数字，不为简单改色或文案新增测试。

请勿提交本机数据目录、auth.json、日志、聊天截图或安装备份。界面验收、真实额度查询和合成测试是不同证据，请分别说明。
