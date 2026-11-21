# Infinite Canvas Agent

本地 Canvas Agent 用来连接画布网页和用户电脑上的 Codex / Claude Code。本地开发时优先连接 `http://localhost:3000`，不需要先使用线上站点。

## 独立画布控制 MCP

新增 `mcp --control` 模式：外部 AI 客户端通过本地 MCP 控制网页，MCP 和本机 HTTP 桥接在同一进程运行，不初始化网页内置 AI 对话、历史或 Skill。默认打开 `https://image.cherryai.cn/`，网站须先部署包含控制连接功能的前端。

本发行版使用组织包名 `@cherryai/canvas-agent`，保留上游 MIT 许可与版权声明。控制模式在客户端中的启动配置如下：

给支持本地 stdio MCP 的客户端配置：

```json
{
  "mcpServers": {
    "cherry-canvas": {
      "command": "npx",
      "args": ["-y", "@cherryai/canvas-agent@0.6.0", "mcp", "--control"]
    }
  }
}
```

也可以在本地构建后配置 `node /本机绝对路径/canvas-agent/dist/index.js mcp --control`。源码开发入口是 `npm run dev:control`；stdio 模式的标准输出只供 MCP 协议使用，日志写入标准错误流。

使用流程：

1. AI 调用 `canvas_open`，默认进入画布列表供用户选择；传入 `mode=new` 可以新建画布。
2. 浏览器允许网站访问本机网络后，在画布顶部的「AI 控制」中授权当前画布。读取、编辑和生成分开授权；生成沿用网页当前模型配置和 API Key，可能产生费用。
3. AI 用 `canvas_get_connection_status` 确认授权，再通过画布工具操作。生成是异步提交，通过 `generation_get_status` 查询完成情况。
4. 切换画布、刷新、关闭网页、退出 MCP 或断开控制都会结束授权。重新使用需再次打开并授权，控制不会跟随其他标签页的焦点。

桥接只监听 `127.0.0.1`，由操作系统分配空闲端口；凭据和授权仅存在本次进程内存中。网页连接参数放在 URL 片段中，读取后移除，不写入持久化配置。`--debug` 日志单独位于 `~/.cherry-canvas/logs/`。

需要本地联调时，在 MCP 客户端配置中添加：

```json
{
  "env": {
    "CANVAS_CONTROL_SITE_URL": "http://localhost:3000/"
  }
}
```

若网站发布在子路径，设置完整站点根路径，例如 `https://image.cherryai.cn/canvas/`。该地址由用户的 MCP 启动配置指定，AI 工具不能传入任意域名。HTTPS 线上站点访问本机服务需要浏览器的本地网络权限；拒绝或撤销权限后应在网页重新连接。

首版支持画布节点、连线、选区、视口及生成，不开放工作台、素材库、全站配置和内置对话附件。`canvas_export_snapshot` 是结构化信息，不能当作截图；图片内容不返回给 AI，长文本沿用原有摘要阈值并通过 `truncatedFields` 标记。编辑回执表示已应用到页面，不表示本地已经落盘。断开控制不会取消已经提交的生成。

操作等待沿用现有 30 秒，请求体上限沿用 30MB。取消、断线或超时不自动重放写操作；结果未知时先重新授权并读取状态，避免重复生成。控制协议版本独立于原 Agent 协议及消息存储格式，版本不匹配时拒绝连接。

控制范围回归用例已加入 `npm run test:control`，由开发者按需执行。

## 启动

```bash
npx -y @cherryai/canvas-agent@latest
```

带上 `@latest` 是因为 npx 会缓存已下载的版本，不加就可能一直运行旧版本。

需要排查连接、线程、Codex app-server 或工具调用问题时，可开启 Debug 模式：

```bash
npx -y @cherryai/canvas-agent@latest --debug
```

Debug 日志会以 `[DEBUG][HH:mm:ss]` 等传统格式输出到终端，并按启动日期保存到 `~/.infinite-canvas/logs/canvas-agent-YYYY-MM-DD.log`。终端日志带级别颜色，文件日志为纯文本；日志包含 HTTP、SSE、线程、turn、Codex app-server 和工具调用事件，token 与图片 Data URL 会自动隐藏。

本仓库开发时也可以直接运行：

```bash
cd canvas-agent
npm install
npm run build
node dist/index.js
```

启动后会输出本机地址和 token：

```txt
Local URL: http://127.0.0.1:17371
Connect token: xxxxxx
```

在画布右上角点击 `Agent`，填入地址和 token 后连接。

Codex app 插件会读取启动输出里的 Local URL 和 Connect token，并直接打开画布网页地址；Canvas Agent 不负责生成画布打开 URL。

完整 Canvas Agent 默认只监听 `127.0.0.1`，并记录持有正确 token 的网页 Origin。独立 `mcp --control` 模式则只接受启动配置中站点的 Origin，不复用这里的连接配置。

## 发布

`@cherryai/canvas-agent` 使用自己的 `package.json` 版本号，不跟仓库根目录 `VERSION` 绑定。当前仓库未配置独立的 npm 发布工作流；维护者在本地登录具备 `cherryai` 组织发布权限的 npm 账号后，通过官方 registry 公开发布。包内只包含构建产物、运行说明、Agent 指令及 MIT 许可。

同事拉取包含本次 MCP 改动的分支后，在仓库根目录执行：

```bash
cd canvas-agent
npm ci
npm login --registry=https://registry.npmjs.org/
npm whoami --registry=https://registry.npmjs.org/
npm publish --access public --registry=https://registry.npmjs.org/
npm view @cherryai/canvas-agent@0.6.0 version dist.integrity --json --registry=https://registry.npmjs.org/
```

发布者使用自己的 npm 账号，并在 `cherryai` 组织中拥有相应发布权限。`npm publish` 会通过 `prepack` 自动构建，因此不需要提交 `dist` 或复制其他电脑的构建产物；登录和双重验证在发布者本人电脑上完成，不提交 `.npmrc`、Token 或 `node_modules`。如果相同版本已经存在，先提升本目录 `package.json` 的版本并同步锁文件，再发布新版本。发布 npm 包不会部署画布网页，线上使用前仍需部署本次前端改动。


## Codex MCP

如果希望 Codex 终端能直接操作画布，需要先把 Canvas Agent 注册成 Codex MCP。

直接运行 `npx -y @cherryai/canvas-agent@latest` 只启动本地 Agent 服务，不会安装 MCP，也不会增加 Codex 工具上下文。只有安装 Codex app 插件，或手动执行 `codex mcp add` 后，`infinite-canvas` 工具才会进入 Codex 上下文；由于工具较多，不使用时建议移除。

通过插件安装时移除插件：

```bash
codex plugin remove infinite-canvas
```

手动添加 MCP 时移除 MCP：

```bash
codex mcp remove infinite-canvas
```

### Codex app 插件

仓库内提供了 Codex app 插件：`plugins/infinite-canvas`。在 Codex app 中添加本仓库的 marketplace 后，可以安装 `Infinite Canvas` 插件；插件会注册同一个 `infinite-canvas` MCP，并带上画布操作说明。

添加本地 marketplace 时建议使用仓库绝对路径，避免 Codex 从其他工作目录解析失败：

```bash
cd /path/to/infinite-canvas
codex plugin marketplace add "$(pwd)"
codex plugin add infinite-canvas@infinite-canvas-local
```

插件默认通过 npm 启动 MCP；这个命令只提供 MCP 工具，不会把 MCP 写入全局配置，也不会在退出时自动卸载：

```bash
npx -y @cherryai/canvas-agent@latest mcp
```

使用时可以直接在 Codex 里说“打开 Infinite Canvas”，插件会启动本地 Agent，读取 Local URL 和 Connect token，然后在右侧打开 `https://canvas.best/` 并自动新建、连接画布；只有明确要求使用本地项目时才会启动本地前端。

Canvas Agent 启动后，给 Codex 添加 MCP：

```bash
codex mcp add infinite-canvas -- npx -y @cherryai/canvas-agent@latest mcp
```

本仓库开发时可以改成，实际使用建议替换为本机绝对路径：

```bash
codex mcp add infinite-canvas -- node /path/to/infinite-canvas/canvas-agent/dist/index.js mcp
```

Canvas Agent 源码使用 TypeScript 编写，MCP 协议层使用官方 `@modelcontextprotocol/sdk`，工具入参使用 `zod` 描述。

如果希望终端里的 Codex 不被 MCP 审批卡住，可以在 `~/.codex/config.toml` 里给这个 MCP 设置自动放行：

```toml
[mcp_servers.infinite-canvas]
command = "npx"
args = ["-y", "@cherryai/canvas-agent@latest", "mcp"]
default_tools_approval_mode = "approve"
```

可用工具：

- `canvas_get_state`
- `canvas_get_selection`
- `canvas_export_snapshot`
- `canvas_apply_ops`
- `canvas_create_text_node`
- `canvas_create_image_prompt_flow`

`canvas_apply_ops` 示例：

```json
{
  "ops": [
    {
      "type": "add_node",
      "nodeType": "text",
      "title": "标题",
      "position": { "x": 0, "y": 0 },
      "metadata": { "content": "文本内容" }
    }
  ]
}
```

## 侧边栏 Codex

本地面板会把提示词发送给 Canvas Agent。Canvas Agent 使用官方 `@openai/codex` CLI 的 `codex app-server --stdio` 启动并复用同一个 Codex thread，启动时会注入 `infinite-canvas` MCP 配置并自动放行 MCP 审批，真正执行画布修改前仍由网页侧边栏二次确认。

侧边栏会展示 Codex 返回的 `thread.started`、`turn.started`、`item.*`、`turn.completed` 等结构化事件；Canvas Agent 会合并短时间内的回复、思考摘要和命令输出增量，网页使用同一条消息持续更新，并把任务进度、计划、搜索、文件修改与工具操作整理为中文过程时间线。

侧边栏上传或粘贴的图片会先发到本机 Canvas Agent，再由 Canvas Agent 临时写入本机文件并作为 app-server `localImage` 输入传给 Codex；前端会提示附件体积，单次请求体限制为 30MB。

## Claude Code

Claude Code Adapter 代码暂时保留，但当前网页侧边栏只开放 Codex。后续开放 Claude 入口时，Canvas Agent 会调用本机 `claude -p --output-format stream-json` 并把流式 JSON 事件转发到侧边栏。

如果希望 Claude Code 也能操作画布，需要给 Claude Code 添加同一个 MCP。建议用 user scope，避免 Canvas Agent 从不同目录启动时找不到配置：

```bash
claude mcp add --scope user --transport stdio infinite-canvas -- npx -y @cherryai/canvas-agent@latest mcp
```

本仓库开发时可以改成：

```bash
claude mcp add --scope user --transport stdio infinite-canvas -- node /path/to/infinite-canvas/canvas-agent/dist/index.js mcp
```

Canvas Agent 调用 Claude Code 时会默认带上 `--allowedTools mcp__infinite-canvas__*`，画布写操作仍由网页侧边栏确认。
