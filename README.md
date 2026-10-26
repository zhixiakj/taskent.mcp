# taskent

把 AI 编码代理（ZCode、Claude Code 等）里的任务状态变化，可靠地采集并上报到你的 taskent 服务端。上报链路永不阻塞 agent——先写本地队列，再异步转发，断网自动重传。

## 组成

- **MCP server**（stdio）：提供 `task_upsert`、`task_list` 两个工具，agent 可主动上报任务进展、拉取未完结任务续接工作
- **hooks 被动捕获**：监听编码代理的任务/会话事件，无需 agent 配合即可采集状态变化（主通道）
- **本地缓冲转发**：队列文件落盘后立即返回，独立循环转发，失败指数退避

## 状态

早期开发中，尚未发布到 npm。首个可用版本将提供 `npx taskent init`，一条命令完成配置接入。

## License

发布前确定。
