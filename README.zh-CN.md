# Taskent

[![npm](https://img.shields.io/npm/v/taskent)](https://www.npmjs.com/package/taskent)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

把 AI 编码代理(Claude Code、ZCode 等)里的任务状态变化,可靠地采集并上报到 [Taskent](https://taskent.io)。上报链路永不阻塞 agent——先写本地队列,再异步转发,断网自动重传。

[English](README.md) · [官网](https://taskent.io) · [总览看板](https://app.taskent.io)

## 组成

- **hooks 被动捕获**(主通道):监听编码代理的任务/会话事件,无需 agent 配合即可采集状态变化
- **MCP server**(stdio):提供 `task_upsert`、`task_list` 两个工具,agent 可主动上报任务进展、拉取未完结任务续接工作
- **本地缓冲转发**:队列文件落盘后立即返回(毫秒级、离线可用),独立循环转发,失败指数退避(1m/5m/30m 封顶),at-least-once + 服务端幂等 upsert

## 前置条件

- Node.js ≥ 18
- taskent 账号:在 [app.taskent.io](https://app.taskent.io) 用 **GitHub 或 Google** 登录,然后在 *Settings → Collector tokens* 创建**采集令牌**(每机一枚、可吊销)

## 安装与接入

```bash
npm install -g taskent   # 推荐:hooks 需要本地二进制(毫秒启动、离线可用)
taskent init             # 交互式配置:令牌、机器名、主 harness
taskent add agent        # 接入各编码代理——自动写入其 MCP/hooks 配置
taskent doctor           # 体检:配置 / 版本 / 队列积压 / 各 agent 注册 / 服务端连通
```

免安装试用:`npx taskent init`。

`init` 保存机器级配置(令牌、机器名、主 harness),之后 `taskent add agent` 一条命令把 taskent 注册进各编码代理——MCP server 加任务 hooks,合并写入 agent 自己的配置文件:写前确认、写前自动备份(带时间戳)、幂等可重复执行。

| Harness | 写入文件 | 采集能力 |
|---|---|---|
| ZCode | `~/.zcode/cli/config.json` | hooks + MCP(ZCode 无 `Notification` 事件) |
| Claude Code | `~/.claude/settings.json` + `~/.claude.json` | hooks(含「等待输入」)+ MCP |
| Gemini CLI | `~/.gemini/settings.json` | 仅 MCP(手动任务更新 + 心跳) |
| Cursor | `~/.cursor/mcp.json` | 仅 MCP |
| OpenCode | `~/.config/opencode/opencode.json` | 仅 MCP |
| DeepSeek Harness | `~/.dsh/cordis.patch.yml`(追加 Cordis 补丁) | 仅 MCP |
| Kimi Code | `~/.kimi-code/mcp.json` + `~/.kimi-code/config.toml`(追加 hooks) | hooks(含「等待输入」)+ MCP |
| Codex | —(打印 `config.toml` 片段) | 仅 MCP,暂需手工粘贴 |

`taskent add agent <harness>` 直接指定,`taskent add agent` 交互选择(自动标注哪些 agent 已检出、哪些已配置)。想手工粘贴、或用表外的 harness?下面这些参考块就是 `add agent` 所写的内容:

### ZCode

两个块都写进 `~/.zcode/cli/config.json`(与已有键合并)。ZCode 有两处不同:配置文件 hooks 必须设 `"enabled": true` 且事件嵌在 `events` 下;没有 `Notification` 事件(「等待输入」暂不采集)。配置后需新开 ZCode 会话生效。

MCP 注册(`mcp` 键):

```json
{ "mcp": { "servers": { "taskent": { "command": "taskent", "args": ["mcp"], "env": { "TASKENT_HARNESS": "zcode" } } } } }
```

任务采集(`hooks` 键):

```json
{
  "hooks": {
    "enabled": true,
    "events": {
      "PostToolUse": [
        { "matcher": "Task|TodoWrite", "hooks": [ { "type": "command", "command": "taskent hook --harness zcode --event PostToolUse" } ] }
      ],
      "Stop": [
        { "hooks": [ { "type": "command", "command": "taskent hook --harness zcode --event Stop" } ] }
      ]
    }
  }
}
```

### Claude Code

MCP 注册(`.mcp.json` 或 `claude mcp add`):

```json
{ "mcpServers": { "taskent": { "command": "taskent", "args": ["mcp"], "env": { "TASKENT_HARNESS": "claude-code" } } } }
```

hooks(`~/.claude/settings.json`):

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

### 其它 harness

MCP server 是标准 stdio MCP,在 harness 读取 MCP 配置处注册 `taskent mcp` 即可。hooks 是自动采集通道:若你的 harness 有 Claude Code 兼容的 hook 事件(stdin JSON 含 `tool_name` / `tool_input` / `session_id`),同样的 hook 命令可直接套用。

配好后用同一账号打开 [app.taskent.io](https://app.taskent.io),让 agent 跑个任务,约 30 秒内出现在总览页。

## 端到端加密(opt-in)

```bash
taskent encrypt           # 设置口令;密钥本地派生(PBKDF2-SHA256, 600k 迭代)
```

口令永不上传。任务标题、进度、项目名在上报前以 AES-256-GCM 加密,服务端只见密文与盲索引;在看板 E2EE 卡输入同一口令即可解密。加密项目显示为 `P1`、`P2`…(编号可改名),状态、分组、推送触发不受影响。**口令遗忘 = 数据不可恢复**——可留一条可选的**提示语**(`--hint`,或口令后的交互提问);它**明文存放在服务端**、展示在解锁处,切勿把口令本身写进去。

## 命令一览

| 命令 | 用途 |
|---|---|
| `taskent init` | 交互式配置:令牌、机器名、主 harness |
| `taskent add agent [HARNESS] [--yes]` | 自动把 taskent 注册进编码代理(zcode、claude-code、gemini、cursor、opencode、deepseek、kimi;codex 打印片段) |
| `taskent mcp` | 启动 MCP server(stdio,供 harness 注册) |
| `taskent hook --harness H --event E` | hooks 入口(stdin 读 JSON 负载) |
| `taskent encrypt [--passphrase P] [--hint H]` | 开启/重设端到端加密(可选提示语,明文存服务端) |
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

v0.2.0,早期访问。0.2.0 起为多用户账号体系(GitHub/Google 登录、数据按用户隔离、每机一枚可吊销的采集令牌)。采集链路(队列/hooks/MCP/E2EE/doctor)已可用;`taskent add agent` 自动配置各 harness(0.2.8 起 ZCode、Claude Code、Gemini、Cursor、OpenCode、DeepSeek Harness;0.2.9 起 Kimi Code;Codex 打印片段)。

## License

[MIT](LICENSE)
