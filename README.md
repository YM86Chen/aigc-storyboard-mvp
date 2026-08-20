# 帧语

帧语是一个面向 AI 短剧创作的私有云端故事板工作台。登录用户可以把脚本拆解为角色、场景和固定 6 镜头故事板，继续编辑图生视频提示词，并在不同设备恢复自己的项目。

## 核心能力

- 使用 Sites / ChatGPT 平台身份登录，不维护自建账号或密码。
- Cloudflare D1 是登录用户项目的权威数据源；每次读写均按平台用户 ID 隔离。
- 项目保存完整脚本、角色、场景、6 个镜头和每镜头 `videoPrompt`，同时记录提示词是自动生成还是手动编辑，以及是否需要按最新资产重建。
- 800ms 防抖自动保存，显示保存中、已保存、失败和版本冲突状态。
- 镜头序号、上一个/下一个导航提供单镜头聚焦编辑；资产变化会标记受影响提示词，批量重建不会覆盖手动提示词。
- 支持单条复制、整套提示词复制、Markdown 导出和 JSON 备份。
- 生成期间前端锁定提交；服务端用 D1 对同一用户做并发租约和 60 秒保守频率限制，脚本上限为 6000 字。
- 本地 `localStorage` 仅用于匿名草稿、临时缓存和用户明确触发的云端迁移，不会自动上传。
- 保留 DeepSeek 生成、提示词重建/复制、Markdown 导出和经过校验的 JSON 备份。

## 本地开发

要求 Node.js `>=22.13.0`。

```bash
npm install
npm run dev
```

本地环境变量只需要服务端使用的 DeepSeek Key：

```bash
cp .env.example .env.local
```

不要提交 `.env.local`。自动化测试不会读取或修改它，也不会向真实 DeepSeek 发请求。

## 数据库

`.openai/hosting.json` 声明逻辑 D1 绑定 `DB`。表结构位于 `db/schema.ts`，生成的迁移保存在 `drizzle/`。

```bash
npm run db:generate
```

`projects` 表包含 `id`、`owner_id`、`name`、`script`、`storyboard_json`、`version`、`created_at` 和 `updated_at`。更新使用 `owner_id + id + version` 原子条件，过期版本返回 409，不会静默覆盖其他设备的修改。

`generation_limits` 表只保存用户 ID、最小请求标识和时间戳，用于原子阻止同一用户的并发或短时间重复生成；不保存脚本、模型响应或凭据。

## 身份与 API

平台负责 `/signin-with-chatgpt`、`/signout-with-chatgpt` 和 `/callback`。应用只读取可信的 `oai-authenticated-user-id` 与相关显示信息，客户端不能指定 `ownerId`。

- `GET /api/session`：返回当前可选登录状态和平台登录/退出路径。
- `GET /api/projects`：列出当前用户项目。
- `POST /api/projects`：创建当前用户项目。
- `GET /api/projects/:id`：获取当前用户单个项目。
- `PUT /api/projects/:id`：按版本保存当前用户项目。
- `DELETE /api/projects/:id`：删除当前用户项目。
- `POST /api/generate-storyboard`：登录后调用服务端 DeepSeek 生成链路；脚本过长、并发请求或 60 秒频率限制命中时会在调用模型前拒绝。

所有受保护 API 在未登录时返回安全的中文 401；项目错误不会泄露数据库细节、API Key、模型原始响应或其他用户数据。

## 验证

```bash
npm test
npm run lint
npm run build
```

测试覆盖未登录、跨用户越权、无效故事板、版本冲突、保存恢复、本地备份、提示词状态、手动提示词保护、并发/频率限制和 mock DeepSeek 生成。部署由 Sites 管理 D1 资源、迁移、私有访问策略与运行时 `DEEPSEEK_API_KEY`。
