# MCP、数据路径与代码来源

核查日期：2026-10-22。本项目是独立维护的派生版本，不是 OpenAI 官方产品，也不代表上游作者提供服务。

## MCP 在哪里运行

`.mcp.json` 注册名为 `rin` 的 MCP（模型上下文协议）服务。宿主在本机执行 `node <插件目录>/runtime/mcp.mjs`，通过标准输入输出通信。`${CLAUDE_PLUGIN_ROOT}` 是插件根目录占位符，不是远程地址，也不表示向 Claude 服务发送数据。

该适配器再通过 `runtime/bridge.mjs` 连接本机挂件。Windows 使用以本项目数据目录生成的命名管道；macOS 使用本机 Unix socket。没有远程 MCP URL，也没有原作者的服务器、账号或密钥。保留的内部 `whale` / `dsh` 标识来自旧实现；公开 MCP 工具统一为 `rin_quota`、`rin_balance`、`rin_usage`、`rin_status`、`rin_open`。

## 哪些操作会联网

| 路径 | 行为 |
| --- | --- |
| MCP 初始化与工具清单 | 读取本地代码，通过标准输入输出返回；不查询账号 |
| 官方订阅额度 | 启动已安装且验证签名的官方 Codex CLI，调用 `account/rateLimits/read`；沿用使用者本机登录，由官方程序查询服务 |
| 本机会话用量 | 在本机解析 Codex 用量记录；不发给上游挂件作者 |
| API 钱包模式 | 连接使用者自己配置的服务商地址，不提供共享密钥或代理账户 |
| 汇率 | 继承的汇率模块查询 `api.frankfurter.dev` |
| 首次安装桌面组件 | npm 下载固定版本的 Electron 及其依赖 |

“本地 MCP”不等于整个应用完全离线。仓库不包含登录凭据、运行时管道令牌、聊天记录和私人安装备份。

## 可复核的代码来源

最初保存的 `runtime/mcp.mjs` 与 [MeteorNOX 的 For-Codex 文件](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget/blob/7fa45961c0e0bacc9bb08737f73b4491399956b0/runtime/mcp.mjs) 的 Git blob SHA 完全一致：`2b0f2247e11affd2cc6c042c17f29ccc2fe5c866`。原始 LICENSE 的 blob SHA 为 `e347bcdf559e0ab4f5a2ea83cf9b027f7426341c`。

对应的 [For-Codex LICENSE](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget/blob/7fa45961c0e0bacc9bb08737f73b4491399956b0/LICENSE) 是 MIT。Codex 适配现由 [Yang-huai406/Codex-Whale-Public](https://github.com/Yang-huai406/Codex-Whale-Public) 维护，该仓库也保留 [MIT LICENSE](https://github.com/Yang-huai406/Codex-Whale-Public/blob/main/LICENSE)。本项目继承后修改 MCP 身份、额度工具和默认数据目录；改名不改变代码来源，也不替代许可和署名。

## 媒体与公开历史

上游 [素材说明](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget/blob/main/PROVENANCE.md) 将媒体排除在代码 MIT 之外；[Codex 适配素材说明](https://github.com/Yang-huai406/Codex-Whale-Public/blob/main/docs/MATERIALS-PERMISSION.md) 记录的是其特定分发范围，不自动授予本项目额外再许可。

因此，本项目不发布 `DSniang1.png`、`DSniang02.png`、`DSH2.png`、`rua.gif`、`bubble-petpet.gif`、`bubble-yue-money.gif`、`D1.mp3`、`D2.mp3`、`Ya1.mp3`、`Ya2.mp3`。公开源码、压缩包和公开 Git 历史均排除这些文件；原开发历史只保留在维护者本地备份。

公开版只附带维护者提供并确认可修改、分发的 `assets/rin-default.png` 和 `themes/rin/quotes.json`，保留自定义导入及代码合成提示音。默认旧音效组改为静音。维护者对自供素材的授权声明与上游代码许可是两项不同依据；本记录不声称独立核验了所有潜在第三方权利。
