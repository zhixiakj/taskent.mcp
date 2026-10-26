# taskent

把 AI 编码代理（ZCode、Claude Code 等）里的任务状态变化，可靠地采集并上报到你的 taskent 服务端。上报链路永不阻塞 agent——先写本地队列，再异步转发，断网自动重传。

## 组成

- **MCP server**（stdio）：提供 `task_upsert`、`task_list` 两个工具，agent 可主动上报任务进展、拉取未完结任务续接工作
- **hooks 被动捕获**：监听编码代理的任务/会话事件，无需 agent 配合即可采集状态变化（主通道）
- **本地缓冲转发**：队列文件落盘后立即返回，独立循环转发，失败指数退避（1m/5m/30m 封顶）

## 安装与接入

```bash
npm install -g taskent   # 推荐：hooks 需要本地二进制（毫秒启动、离线可用）
taskent init             # 写配置 + 打印 MCP/hooks 两段可直接粘贴的注册片段
taskent doctor           # 体检：配置 / 版本 / 队列积压 / 服务端连通
```

免安装试用：`npx taskent init`、MCP 注册用 `npx -y taskent@latest mcp`。

## 升级

- `taskent upgrade` 一条命令自更新（`npm i -g taskent@latest`）
- 版本检查每日最多一次、3 秒超时、只提示不自动安装；hook 路径永不联网查版本
- 向后兼容承诺：旧客户端永远可以上报——payload 带版本字段，服务端忽略未知字段，hooks 失败恒退出 0 不影响你的编码会话

## 命令一览

| 命令 | 用途 |
|---|---|
| `taskent init` | 交互式配置，输出 MCP/hooks 注册片段 |
| `taskent mcp` | 启动 MCP server（stdio，供 harness 注册） |
| `taskent hook --harness H --event E` | hooks 入口（stdin 读 JSON 负载） |
| `taskent flush` | 手动清空本地队列 |
| `taskent upgrade` | 自更新到最新版 |
| `taskent doctor [--force]` | 健康检查 |

## 隐私

只上报任务元数据（标题、状态、项目名、agent/机器名、时间戳）；不上报任务正文、代码或 prompt。本地队列与配置存于 `~/.taskent/`。

## 状态

早期开发中，尚未发布到 npm。

## License

发布前确定。
