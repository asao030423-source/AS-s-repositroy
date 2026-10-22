---
name: codex-rin-companion
description: 显示跟随 Codex 的凛桌面伴侣，查询官方订阅额度与已观测用量，管理角色、台词和气泡。用于用户明确提到凛挂件或额度，不用于普通编码任务。
---

# Codex Rin Companion

- 官方订阅额度使用 `rin_quota`；说明数据来源和采样时间，存在 stale 或 errorCode 时明确说明。缺失的窗口不补零。
- 显示挂件使用`rin_open`；`rin_status` 查看状态。
- `rin_balance` 查询显式配置的 API 钱包，`rin_usage` 查询本机已观测记录。两者都不等于官方订阅额度，不混合比较。
- 角色、气泡、台词和音效优先在挂件界面修改。开发者默认素材为 assets/rin-default.png，默认台词为 themes/rin/quotes.json。
- 连接失败可运行插件根目录的 `node scripts/diagnose.mjs`；用户要求验证真实额度时加 `--live`。不要手写 CLI 版本路径，不要修改 Codex 默认提供商或登录状态。
- 不输出密钥、账号标识、auth.json、完整日志或聊天正文。只分享脱敏错误码、版本和时间。
- 安装与回滚见 README；涉及删除用户数据、退出登录或改变安全权限须先征得用户同意。
