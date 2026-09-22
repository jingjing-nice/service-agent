# Service Agent

一个面向企业客服场景的全栈智能服务台。项目包含会话工作台、消息持久化和一套带发布流程的 RAG（Retrieval-Augmented Generation，检索增强生成）知识库。

> 当前版本适合本地开发和功能验证。正式部署前请先阅读[已知限制](#已知限制)，尤其是鉴权、生产聊天入口和文档格式限制。

## 主要能力

- React 客服工作台与会话管理
- 基于 SSE 的大模型流式回答
- 知识文档上传、切片、向量化和异步处理
- 知识草稿预览、发布、下架、归档和删除
- Milvus 语义召回与本地关键词召回的混合排序
- 租户、知识库、发布状态、索引版本及正文哈希的多重校验
- 回答引用提取、持久化和切片回查
- 无有效知识来源时拒绝调用模型自由作答
- RAG 退款政策检索、确定性资格判断与 LangGraph Human-in-the-Loop
- 退款人工审批中心、幂等模拟退款网关和审批结果消息通知

## 技术栈

| 层级 | 技术                                                |
| ---- | --------------------------------------------------- |
| Web  | React 18、Vite、Ant Design、Zustand、TanStack Query |
| API  | NestJS 12、Fastify、Prisma、LangChain               |
| 数据 | PostgreSQL 16、Milvus 3、MinIO、Redis/BullMQ        |
| 工程 | TypeScript、pnpm workspace、Vitest、Oxlint          |

## 仓库结构

```text
service-agent/
├── apps/
│   ├── api/                 # NestJS API、Prisma 模型及迁移
│   └── web/                 # React 客服工作台
├── packages/
│   └── contracts/           # 前后端共享的 Zod Schema 和类型
├── compose.yaml             # PostgreSQL、Redis、MinIO、Milvus、etcd
└── .env.example             # 本地基础设施配置示例
```

## RAG 工作流程

### 写入链路

1. 上传文件后，原文件写入 MinIO，元数据写入 PostgreSQL。
2. BullMQ 将解析和索引任务写入 Redis。
3. Worker 解析 Markdown、切片，并将切片正文保存到 PostgreSQL。
4. Embedding 服务生成 1024 维向量，草稿向量写入 Milvus。
5. 发布操作将指定索引版本切换为 `PUBLISHED`；只有已发布文档参与正式问答。

文档状态大致按以下方向流转：

```text
UPLOADED -> PARSING -> CHUNKED -> READY
                                  |
                         DRAFT -> PUBLISHED
```

### 查询链路

1. 用户问题生成查询向量，并在 Milvus 中按租户、知识库和发布状态过滤。
2. PostgreSQL 回查候选切片，校验文档状态、索引版本和正文哈希。
3. 系统同时计算关键词覆盖率，并按“语义 70% + 关键词 30%”进行确定性重排。
4. 最多选取 5 个切片进入模型上下文。
5. 模型只能依据这些切片回答；回答中的 `[1]`、`[2]` 等编号会转换为结构化引用。

Milvus 只承担候选召回。可展示的正文始终以 PostgreSQL 为事实来源，避免陈旧或被错误标记的向量直接进入模型上下文。

## 退款 Agent 闭环

退款属于高风险业务操作，系统不会让大模型直接决定或执行资金操作：

```text
客户提出退款并提供订单号
  → RAG 检索已发布退款政策
  → 查询订单并验证状态
  → 确定性规则引擎判断资格
  → 创建幂等退款申请
  → LangGraph interrupt 暂停等待人工审批
  → 审批中心通过或拒绝
  → 幂等模拟退款网关执行
  → PostgreSQL 保存渠道流水与最终状态
  → 会话消息通知客户并附政策引用
```

本地演示步骤：

1. 上传并发布 `apps/api/src/scripts/refund-policy.md`，配置 `DEFAULT_KNOWLEDGE_BASE_ID`。
2. 创建或选择一个会话，发送 `帮我退款 DEMO-ORDER-001`。
3. 点击左侧导航的“退款审批”，查看政策证据和退款金额。
4. 点击“批准退款”或“拒绝”；审批完成后，会话消息会自动刷新并显示处理结果。

`DEMO-ORDER-001` 用于成功场景，`DEMO-ORDER-OLD` 用于超期场景，
`DEMO-ORDER-REFUNDED` 用于重复退款拦截。退款渠道是本地模拟适配器，不会产生真实资金交易。

## 本地开发

### 环境要求

- Node.js 20 或更高版本
- pnpm 10
- Docker 与 Docker Compose
- OpenAI 兼容的聊天模型和 Embedding 服务

### 1. 安装依赖

```bash
pnpm install
```

### 2. 启动基础设施

```bash
docker compose up -d
docker compose ps
```

默认端口：

| 服务                 | 端口             |
| -------------------- | ---------------- |
| PostgreSQL           | `5432`           |
| Redis                | `6380`           |
| MinIO API / Console  | `9000` / `9001`  |
| Milvus gRPC / Health | `19530` / `9091` |

### 3. 配置 API

复制示例文件，然后在 `apps/api/.env` 中补充模型和业务配置：

```bash
cp .env.example apps/api/.env
```

除示例文件中的基础设施变量外，API 还需要以下配置：

```dotenv
DATABASE_URL=postgresql://service_agent:service_agent_dev@localhost:5432/service_agent

DEFAULT_TENANT_ID=tenant-local-dev
DEFAULT_KNOWLEDGE_BASE_ID=<PostgreSQL 中的知识库 UUID>

LLM_MODEL=<聊天模型名称>
LLM_API_KEY=<聊天模型 API Key>
LLM_BASE_URL=<OpenAI 兼容接口地址>

EMBEDDING_MODEL=qwen3.7-text-embedding
EMBEDDING_API_KEY=<Embedding API Key>
EMBEDDING_BASE_URL=<OpenAI 兼容接口地址>
EMBEDDING_DIMENSION=1024

# 可选，默认 0.55，合法范围为 -1 到 1。
KNOWLEDGE_MIN_SCORE=0.55
```

不要提交包含真实密钥的 `apps/api/.env`。

### 4. 初始化数据结构

执行 Prisma 迁移和客户端生成：

```bash
pnpm --filter @service-agent/api exec prisma migrate deploy
pnpm --filter @service-agent/api exec prisma generate
```

当前仓库没有知识库 seed。首次运行时需要在 PostgreSQL 的 `knowledge_bases` 表中创建一条记录，并把其 UUID 配置为 `DEFAULT_KNOWLEDGE_BASE_ID`。

Milvus collection 名称为 `knowledge_chunks_v1`，Schema 定义在 `apps/api/src/modules/knowledge/vector/knowledge-vector.schema.ts`。当前应用不会在启动时自动创建 collection，首次使用前需根据该 Schema 完成初始化和加载。

### 5. 启动应用

```bash
pnpm dev
```

- Web：<http://localhost:3000>
- API：<http://localhost:8000>
- 健康检查：<http://localhost:8000/api/health>

也可以单独启动：

```bash
pnpm dev:web
pnpm dev:api
```

## 常用接口

| 方法       | 路径                                       | 用途               |
| ---------- | ------------------------------------------ | ------------------ |
| `GET`      | `/api/health`                              | 服务健康检查       |
| `GET/POST` | `/api/conversations`                       | 查询或创建会话     |
| `GET`      | `/api/llm/stream`                          | SSE 流式 RAG 回答  |
| `GET`      | `/api/refunds/approvals`                   | 查询待审批退款     |
| `POST`     | `/api/refunds/approvals/:id/decision`      | 审批并执行退款     |
| `POST`     | `/api/knowledge/documents`                 | 上传知识文档       |
| `GET`      | `/api/knowledge/documents`                 | 查询文档列表       |
| `GET`      | `/api/knowledge/documents/:id`             | 查询文档及处理状态 |
| `GET`      | `/api/knowledge/documents/:id/chunks`      | 预览切片           |
| `POST`     | `/api/knowledge/documents/:id/index-draft` | 手动建立草稿索引   |
| `POST`     | `/api/knowledge/documents/:id/publish`     | 发布当前索引版本   |
| `POST`     | `/api/knowledge/documents/:id/unpublish`   | 下架文档           |
| `POST`     | `/api/knowledge/documents/:id/archive`     | 归档文档           |
| `DELETE`   | `/api/knowledge/documents/:id`             | 删除文档及关联向量 |

知识管理、草稿检索及当前聊天流接口在未接入正式鉴权前仅允许本机开发请求；部分接口在生产环境会返回 404。

## 质量检查

```bash
# 全部单元测试
pnpm test

# API 端到端测试（当前主要覆盖健康检查）
pnpm --filter @service-agent/api test:e2e

# 类型检查与生产构建
pnpm build

# 静态检查
pnpm lint
```

## 关键设计约束

- 租户 ID 和默认知识库 ID 由服务端确定，不接受浏览器任意指定。
- 正式问答只检索 `READY + PUBLISHED` 文档。
- 每个向量携带索引版本和正文 SHA-256；检索结果必须通过 PostgreSQL 回查。
- 草稿发布保持幂等，索引重建后旧版本向量不会进入回答。
- 检索结果为空时返回明确拒答，不让模型使用自身知识补全企业事实。
- 知识片段在 Prompt 中被声明为数据而非指令，以降低文档内 Prompt Injection 风险。
- RAG 只提供政策证据，退款资格由可测试的确定性规则引擎判断。
- 退款审批状态与执行结果持久化到 PostgreSQL；审批执行不依赖进程内 LangGraph 检查点。
- 模拟退款网关使用业务幂等键生成稳定渠道流水，避免重复执行。

## 已知限制

- 实际解析器目前只支持 Markdown。上传校验虽然接受 PDF 和 DOCX，但异步解析会失败。
- 尚未接入登录、JWT、租户上下文和管理员 RBAC；本地 IP 限制不能替代生产鉴权。
- SSE 聊天接口当前同样受本机开发限制，生产模式不可直接使用。
- 关键词召回只扫描最多 200 个已发布切片，适合小规模验证，不适合大型知识库。
- RAG 回归用例目前是单元级验证，尚未覆盖真实 Embedding、Milvus、模型回答和引用的完整链路。
- Milvus collection 与默认知识库需要人工初始化。
- README 中的示例密码只用于本地开发，生产环境必须替换，并为 PostgreSQL、MinIO 和 Milvus 配置持久化、备份及监控策略。

## 后续建议

1. 接入 JWT/RBAC，并从认证上下文解析租户和知识库权限。
2. 修复生产聊天入口限制，拆分草稿调试与正式问答权限。
3. 增加 PDF/DOCX 内容解析，或暂时禁止这两类文件上传。
4. 使用 PostgreSQL 全文索引或搜索引擎替换内存关键词扫描。
5. 增加真实基础设施参与的 RAG E2E、召回评测和回答质量评测。
6. 自动初始化知识库与 Milvus collection，并补充可观测性和故障恢复流程。
