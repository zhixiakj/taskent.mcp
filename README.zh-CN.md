# Taskent

[![npm](https://img.shields.io/npm/v/taskent)](https://www.npmjs.com/package/taskent)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

把 AI 编码代理(Claude Code、ZCode 等)里的任务状态变化,可靠地采集并上报到你的 [Taskent](https://taskent.io) 服务端。上报链路永不阻塞 agent——先写本地队列,再异步转发,断网自动重传。

[English](README.md) · [官网](https://taskent.io) · [总览看板](https://app.taskent.io)

## 组成

- **hooks 被动捕获**(主通道):监听编码代理的任务/会话事件,无需 agent 配合即可采集状态变化
- **MCP server**(stdio):提供 `task_upsert`、`task_list` 两个工具,agent 可主动上报任务进展、拉取未完结任务续接工作
- **本地缓冲转发**:队列文件落盘后立即返回(毫秒级、离线可用),独立循环转发,失败指数退避(1m/5m/30m 封顶),at-least-once + 服务端幂等 upsert

## 前置条件

- Node.js ≥ 18
- taskent 服务端地址 + 上报 token(早期访问:[在 GitHub issue 申请](https://github.com/zhixiakj/taskent.mcp/issues/new?template=access.md))

## 安装与接入

```bash
npm install -g taskent   # 推荐:hooks 需要本地二进制(毫秒启动、离线可用)
taskent init             # 交互式配置 + 打印 MCP/hooks 两段可直接粘贴的注册片段
taskent doctor           # 体检:配置 / 版本 / 队列积压 / 服务端连通
```

免安装试用:`npx taskent init`。

`init` 依次询问服务端地址(`https://app.taskent.io`)、采集令牌、机器名、主 harness(`claude-code` / `zcode` / `other`),然后打印两段配置:

**MCP 注册**(如 `claude mcp add` 或 harness 的 mcp.json):

```json
{ "mcpServers": { "taskent": { "command": "taskent", "args": ["mcp"], "env": { "TASKENT_HARNESS": "claude-code" } } } }
```

**hooks**(Claude Code `settings.json`):

```json
{
  "hooks": {
    "PostToolUse": [
      { "matcher": "Task|TodoWrite", "hooks": [ { "type": "command", "command": "taskent hook --harness claude-code --event PostToolUse" } ] }
    ],
    "Stop": [
      { "hooks": [ { "type": "command", "command": "taskent hook --harness claude-code --event Stop" } ] }
    ],
    "Notification": [
      { "hooks": [ { "type": "command", "command": "taskent hook --harness claude-code --event Notification" } ] }
    ]
  }
}
```

配好后打开 [app.taskent.io](https://app.taskent.io),设置页填同一组服务端地址 + token,让 agent 跑个任务,约 30 秒内出现在总览页。

## 端到端加密(opt-in)

```bash
taskent encrypt           # 设置口令;密钥本地派生(PBKDF2-SHA256, 600k 迭代)
```

口令永不上传。任务标题、进度、项目名在上报前以 AES-256-GCM 加密,服务端只见密文与盲索引;在看板 E2EE 卡输入同一口令即可解密。加密项目显示为 `P1`、`P2`…(编号可改名),状态、分组、推送触发不受影响。**口令遗忘 = 数据不可恢复**。

## 命令一览

| 命令 | 用途 |
|---|---|
| `taskent init` | 交互式配置,输出 MCP/hooks 注册片段 |
| `taskent mcp` | 启动 MCP server(stdio,供 harness 注册) |
| `taskent hook --harness H --event E` | hooks 入口(stdin 读 JSON 负载) |
| `taskent encrypt [--passphrase P]` | 开启/重设端到端加密 |
| `taskent flush` | 手动清空本地队列 |
| `taskent upgrade` | 自更新到最新版 |
| `taskent doctor [--force]` | 健康检查 |

## 隐私

只上报任务元数据(标题、状态、项目名、agent/机器名、时间戳);不上报任务正文、代码或 prompt。开启 E2EE 后上述元数据对服务端也是密文。配置、队列与密钥存于 `~/.taskent/`。

## 升级与兼容

- `taskent upgrade` 一条命令自更新(`npm i -g taskent@latest`)
- 版本检查每日最多一次、3 秒超时、只提示不自动安装;hook 路径永不联网查版本
- 向后兼容承诺:旧客户端永远可以上报——payload 带版本字段,服务端忽略未知字段,hooks 失败恒退出 0 不影响你的编码会话

## 状态

v0.2.0,早期访问。0.2.0 起为多用户账号体系(GitHub/Google 登录、数据按用户隔离、每机一枚可吊销的采集令牌)。采集链路(队列/hooks/MCP/E2EE/doctor)已可用;接入目前为手工粘贴配置片段,自动配置在计划中。

## License

[MIT](LICENSE)
