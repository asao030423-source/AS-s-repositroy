# Codex Rin Companion

免费开源的 Codex 专用桌面伴侣，由 [asao030423-source](https://github.com/asao030423-source) 维护。凛跟随 Codex 窗口，展示官方订阅额度、本机会话用量，并保留角色、气泡、音效和台词的自定义入口。

**v0.1.2 · Windows 预览版。** 当前重点是官方额度连接在 Codex 更新后能够重新发现程序，以及让修改和维护更容易。本项目不是 OpenAI 官方产品，也不提供或改变订阅权限。

## 使用

需要 Windows 11 x64、Node.js 24+（含 npm）、已安装的 ChatGPT/Codex 桌面应用，以及本机有效的 ChatGPT 订阅登录。

1. 下载或克隆[本仓库](https://github.com/asao030423-source/AS-s-repositroy)，解压到一个独立文件夹。
2. 双击 **安装插件.cmd**。它注册独立插件并安装透明桌面运行组件、当前用户的自动跟随任务；首次会下载固定版本的 Electron，需要联网。无需管理员权限。
3. 在 Codex 新建聊天以加载插件工具。使用挂件的会员额度详情查看数据时间，也可以请求“查看 Codex 官方订阅额度”。

这是源码预览版；新用户机器上的首次安装尚需验证，当前证据见 [验证记录](docs/VALIDATION-RIN.md)。macOS 兼容代码保留，但未在本版实机验收；本版官方额度自动发现仅支持 Windows。

## 更新与数据

- 程序安装到用户目录下的 plugins/codex-rin-companion。
- 用户素材和设置保存在 CODEX_HOME/codex-rin-companion；未设置 CODEX_HOME 时，它位于用户目录的 .codex 下。
- 原 api-balance-whale 的代码、设置和计划任务保持独立。首次启动不自动导入旧账号配置或旧账本。
- 更新时重新运行安装插件.cmd。安装器在 LOCALAPPDATA/CodexRinCompanion/backups 留下私人回滚收据，根目录的 **回滚本次安装.cmd** 按该收据恢复；回滚保留当前用户数据。
- **停用自动跟随.cmd** 停用本项目的跟随任务。请勿把用户数据目录或安装备份上传到仓库。

安装入口沿用单次 PowerShell 进程的脚本执行选项，不修改系统或用户执行策略；受组织策略限制时应停止并联系本机管理员，不要求关闭安全防护。

## 气泡

点击凛查询额度时显示“我在帮你看嘛”。普通气泡默认 30 秒未点击后收起；每次点击重新计时，后台刷新不延长时间。每轮对话结束后，气泡显示本轮本机观测的 token 数，例如 12.3K 或 1.2M，默认 5 秒后收起；悬停可看完整数字。点击完成提示可继续看台词。

在菜单的 **凛 · 气泡与底栏** 中分别调整两个时长，范围 1–600 秒。已有的气泡/本轮消耗开关仍有效。没有用量记录时显示未知，不补零；中断和取消不会伪装成正常完成。

## 数据从哪里来

官方额度通过本机、签名有效的 Codex 程序查询 account/rateLimits/read，沿用本机已登录账号。程序更新导致路径变化时自动重新发现，不需要填写版本目录。仅查询额度，不进行模型生成，不修改 Codex 的默认模型连接。

查询失败时保留上次真实样本，并显示原数据时间和错误状态。缺少某种额度时不补零；订阅百分比不换算为固定 Tokens（词元）数量。订阅额度、会话观测值和可选 API 钱包属于不同口径。

诊断：node scripts/diagnose.mjs。附加 --live 可验证一次真实查询，输出版本、时间、窗口数量或错误码，不输出凭据和账号标识。

## 改成你喜欢的样子

角色可以在挂件界面导入；默认图片是 assets/rin-default.png。默认台词放在 themes/rin/quotes.json，修改字符串数组后重启挂件即可。界面仍支持自己的台词和声音。

代码入口、启动方法和 PR 建议见 [CONTRIBUTING.md](CONTRIBUTING.md)，结构说明见 [架构](docs/ARCHITECTURE.md)。不要求复杂插件框架，不设置覆盖率门槛，欢迎小而清楚的改动。

## MCP 与联网

MCP 在本机运行，注册名为 rin，工具名以 rin_ 开头。它是本项目维护的本地适配代码，继承自上游 MIT 实现；不连接原作者的远程 MCP 服务器。官方额度仍由使用者本机 Codex 登录查询。代码来源、联网目的地和许可证证据见 [核查记录](docs/MCP-AND-SOURCES.md)。

公开版仅附带凛图片和台词。原内置文件音效组改为静音，仍可导入自己的图片、动图和音效，或选用已有的代码合成提示音。

## 来源与许可

基于 MeteorNOX 的 [DeepSeek-Balance-Whale-Widget](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget) 及 Yang-huai406 的 Codex 适配继续维护，保留已有窗口和交互。感谢 1llysviel 的 [macOS PR #128](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget/pull/128)。

代码和文档采用 [MIT](LICENSE)。凛默认图片和默认台词由本项目维护者提供并允许随本项目修改、分发；公开版不附带上游鲸鱼图片、动图和 MP3，详见 [来源与许可](PROVENANCE.md) 和 [第三方声明](THIRD_PARTY_NOTICES.md)。
