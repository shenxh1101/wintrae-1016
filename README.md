# 网格化管理后端服务

街道平台网格化管理系统后端服务，提供事件流转和人员走访核心能力。

## 功能模块

| 模块 | 说明 |
|------|------|
| 认证授权 | JWT登录、角色权限控制（管理员/街道/社区/网格员/上级平台） |
| 社区管理 | 社区信息维护、网格划分 |
| 网格区域管理 | 网格区域信息、网格员分配 |
| 居民管理 | 居民信息、标签维护、重点人员标记 |
| 事件流转 | 事件上报 → 派单 → 接单 → 处置 → 回访确认 → 办结 |
| 走访管理 | 日常走访、重点人员走访、问题自动转事件 |
| 矛盾纠纷 | 纠纷登记、调解记录、办结归档 |
| 超时提醒 | 定时检查任务超时，自动发送通知 |
| 附件管理 | 照片、文档等文件上传下载 |
| 统计汇总 | 办结率、超时率、重复事件、走访覆盖等统计 |
| 上级平台对接 | 按网格员/社区/事件类型/时间范围拉取数据 |
| 通知中心 | 系统通知、派单通知、超时提醒 |

## 技术栈

- **框架**: Express 4.x
- **语言**: TypeScript
- **ORM**: TypeORM 0.3.x
- **数据库**: SQLite（默认，可切换为MySQL/PostgreSQL）
- **认证**: JWT (jsonwebtoken + bcryptjs)
- **参数校验**: Zod
- **文件上传**: Multer
- **定时任务**: node-cron
- **日期处理**: Day.js

## 项目结构

```
src/
├── app.ts                 # 应用入口
├── seed.ts                # 初始化种子数据
├── config/
│   ├── index.ts           # 常量配置（角色、状态、类型枚举）
│   └── database.ts        # 数据库连接配置
├── entities/              # TypeORM 数据库实体
│   ├── User.ts            # 用户表
│   ├── Community.ts       # 社区表
│   ├── GridArea.ts        # 网格区域表
│   ├── Resident.ts        # 居民表
│   ├── Event.ts           # 事件表
│   ├── EventFlow.ts       # 事件流转记录表
│   ├── VisitRecord.ts     # 走访记录表
│   ├── DisputeRecord.ts   # 矛盾纠纷表
│   ├── Attachment.ts      # 附件表
│   └── Notification.ts    # 通知表
├── middlewares/
│   └── auth.ts            # 认证中间件
├── routes/                # 路由控制器
│   ├── auth.ts            # 认证与用户管理
│   ├── communities.ts     # 社区管理
│   ├── gridAreas.ts       # 网格区域管理
│   ├── residents.ts       # 居民与标签管理
│   ├── events.ts          # 事件流转
│   ├── visits.ts          # 走访记录
│   ├── disputes.ts        # 矛盾纠纷
│   ├── notifications.ts   # 通知中心
│   ├── attachments.ts     # 附件上传
│   ├── statistics.ts      # 统计汇总
│   └── upperPlatform.ts   # 上级平台数据拉取
├── scheduler/
│   └── tasks.ts           # 定时任务（超时检查）
└── utils/
    └── response.ts        # 通用响应工具
```

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 初始化数据（首次运行）

```bash
npm run seed
```

### 3. 启动开发服务

```bash
npm run dev
```

服务将在 `http://localhost:3000` 启动。

### 4. 生产构建与启动

```bash
npm run build
npm start
```

## 默认账号

密码统一为：`123456`

| 用户名 | 角色 | 说明 |
|--------|------|------|
| admin | 系统管理员 | 全部权限 |
| street01 | 街道管理员 | 街道级管理权限 |
| community01 | 社区管理员 | 东风社区管理员 |
| worker01 | 网格员 | 东风社区第1网格 |
| worker02 | 网格员 | 东风社区第2网格 |
| upper01 | 上级平台 | 数据拉取专用账号 |

## API 接口清单

### 认证授权 `|POST /api/auth/login`
登录获取 Token

`|POST /api/auth/logout`
退出登录

`|GET /api/auth/profile`
获取当前用户信息

`|GET /api/auth/roles`
获取所有角色列表

`|GET /api/auth/users`
用户列表（分页）

`|POST /api/auth/users`
创建用户

`|PUT /api/auth/users/:id`
更新用户

`|PUT /api/auth/users/:id/password`
重置密码

`|DELETE /api/auth/users/:id`
删除用户

### 社区管理 `|GET /api/communities`
社区列表

`|GET /api/communities/:id`
社区详情

`|POST /api/communities`
创建社区

`|PUT /api/communities/:id`
更新社区

`|DELETE /api/communities/:id`
删除社区

### 网格区域 `|GET /api/grid-areas`
网格列表

`|GET /api/grid-areas/:id`
网格详情

`|POST /api/grid-areas`
创建网格

`|PUT /api/grid-areas/:id`
更新网格

`|DELETE /api/grid-areas/:id`
删除网格

### 居民管理 `|GET /api/residents`
居民列表（支持按标签、重点人员筛选）

`|GET /api/residents/tags`
获取可用标签列表

`|GET /api/residents/:id`
居民详情

`|POST /api/residents`
新增居民

`|PUT /api/residents/:id`
更新居民

`|POST /api/residents/:id/tags`
添加/设置标签

`|DELETE /api/residents/:id/tags/:tag`
移除标签

`|DELETE /api/residents/:id`
删除居民

### 事件流转 `|GET /api/events/types`
事件类型列表

`|GET /api/events/statuses`
事件状态列表

`|GET /api/events`
事件列表（支持多条件筛选）

`|GET /api/events/:id`
事件详情（含流转记录）

`|GET /api/events/:id/flows`
事件流转记录

`|POST /api/events/report`
事件上报（通用）

`|POST /api/events/mobile-report`
移动端上报（自动关联网格）

`|POST /api/events/:id/assign`
派单

`|POST /api/events/:id/accept`
接单（网格员）

`|POST /api/events/:id/process`
处置反馈

`|POST /api/events/:id/revisit`
回访确认

`|POST /api/events/:id/return`
退回重办

`|POST /api/events/:id/close`
关闭事件

事件状态流转图：

```
pending(待派单) → assigned(已派单) → processing(处置中)
      ↓              ↓                  ↓
      └──────────────┴──── feedback(待回访) ←──┐
                                          ↓
                                  revisiting(回访中)
                                          ↓
                                  completed(已办结)
                                          ↓
                                    closed(已关闭)
                    任何阶段超期 → overdue(已超时)
```

### 走访记录 `|GET /api/visits/types`
走访类型列表

`|GET /api/visits`
走访列表

`|GET /api/visits/:id`
走访详情

`|POST /api/visits`
提交走访记录（发现问题自动生成待办事件）

`|PUT /api/visits/:id`
更新走访

`|DELETE /api/visits/:id`
删除走访

### 矛盾纠纷 `|GET /api/disputes/types`
纠纷类型列表

`|GET /api/disputes/statuses`
纠纷状态列表

`|GET /api/disputes`
纠纷列表

`|GET /api/disputes/:id`
纠纷详情

`|POST /api/disputes`
新增纠纷

`|PUT /api/disputes/:id`
更新纠纷

`|POST /api/disputes/:id/mediate`
调解记录

`|POST /api/disputes/:id/resolve`
调解完成

`|POST /api/disputes/:id/close`
关闭纠纷

`|DELETE /api/disputes/:id`
删除纠纷

### 通知中心 `|GET /api/notifications`
通知列表

`|GET /api/notifications/unread-count`
未读数量

`|PUT /api/notifications/:id/read`
标记已读

`|PUT /api/notifications/read-all`
全部标记已读

### 附件管理 `|POST /api/attachments/upload`
上传文件（multipart/form-data，字段名 files，最多10个）

`|GET /api/attachments`
附件列表（按业务ID/类型筛选）

`|GET /api/attachments/:id`
附件详情

`|GET /api/attachments/:id/download`
下载文件

`|DELETE /api/attachments/:id`
删除附件

### 统计汇总 `|GET /api/statistics/overview`
概览统计（办结率、超时率、走访覆盖等核心指标）

`|GET /api/statistics/events-by-type`
按事件类型统计

`|GET /api/statistics/events-by-status`
按状态统计

`|GET /api/statistics/events-by-community`
按社区统计（含办结率/超时率）

`|GET /api/statistics/events-by-worker`
按网格员统计事件绩效

`|GET /api/statistics/visits-by-worker`
按网格员统计走访情况

`|GET /api/statistics/events-trend?days=30`
事件趋势（近N天）

`|GET /api/statistics/repeated-events`
重复事件列表

`|GET /api/statistics/grid-stats`
各网格统计数据

### 上级平台数据拉取

所有接口支持分页（page/pageSize）、按时间范围（startTime/endTime）筛选

`|GET /api/upper-platform/events`
拉取事件数据（按 assignedToId/communityId/gridAreaId/eventType/status 筛选）

`|GET /api/upper-platform/visits`
拉取走访数据

`|GET /api/upper-platform/disputes`
拉取纠纷数据

`|GET /api/upper-platform/grid-workers`
获取网格员列表

`|GET /api/upper-platform/communities`
获取社区及网格信息

`|GET /api/upper-platform/residents/summary`
居民数量汇总

`|GET /api/upper-platform/stats/summary`
综合统计数据汇总

## 通用响应格式

```json
{
  "code": 0,
  "message": "操作成功",
  "data": {},
  "total": 100,
  "page": 1,
  "pageSize": 20
}
```

- `code=0` 表示成功，非0表示失败
- 分页接口返回 `total`/`page`/`pageSize`

## 认证方式

所有需要登录的接口，在请求头中携带：

```
Authorization: Bearer <token>
```

## 定时任务

服务启动后自动启动以下定时任务：

| 频率 | 任务 |
|------|------|
| 每5分钟 | 检查事件是否超时，自动标记并发送通知 |
| 每10分钟 | 检查2小时内即将到期的任务，发送提醒通知 |

## 数据存储

- SQLite 数据库文件：`data/grid_management.db`
- 上传附件目录：`uploads/`（按业务类型分子目录）

## 切换数据库

修改 `src/config/database.ts` 中的配置，例如切换到 MySQL：

```typescript
export const AppDataSource = new DataSource({
  type: "mysql",
  host: "localhost",
  port: 3306,
  username: "root",
  password: "xxx",
  database: "grid_management",
  synchronize: true,
  entities: [...],
});
```

## 移动端对接要点

1. 登录：`POST /api/auth/login`（网格员账号）
2. 上报事件：`POST /api/events/mobile-report`（自动关联所在网格，支持经纬度、照片附件）
3. 上传附件：`POST /api/attachments/upload`（携带 bizType=event、bizId=事件ID）
4. 我的待办：`GET /api/events?status=pending,assigned,processing&assignedToId=当前用户ID`
5. 处置反馈：`POST /api/events/:id/process`
6. 走访录入：`POST /api/visits`（支持重点人员走访）

## 街道端展示要点

- 办结率：`GET /api/statistics/overview` 中 completionRate
- 超时率：`GET /api/statistics/overview` 中 overdueRate
- 重复事件：`GET /api/statistics/repeated-events`
- 各社区对比：`GET /api/statistics/events-by-community`
- 网格员绩效：`GET /api/statistics/events-by-worker` + `visits-by-worker`
- 走访覆盖：`GET /api/statistics/overview` 中 visitCoverage
