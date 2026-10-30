# Koishi Meme Backend

Meme 存储后端 (Elysia + Bun + PostgreSQL), 部署在 https://kmeme.itzdrli.cc 。
[Fantastic Spoon](../fantastic_spoon) bot 审核通过的投稿会同步到这里。

## 环境变量

```env
DATABASE_URL=postgres://user:password@postgres:5432/db
JWT_SECRET=至少 32 位的随机字符串
POSTGRES_USER=...
POSTGRES_PASSWORD=...
POSTGRES_DB=...
```

## 运行

```bash
bun install
bun run dev          # 开发, 热重载
docker compose up -d # 生产
```

## 数据库

表结构在 `src/db/schema.ts`, 迁移在 `drizzle/`:

```bash
bunx drizzle-kit generate --name <描述>  # 修改 schema 后生成迁移
bunx drizzle-kit push                    # 同步到数据库
```

## API

| 方法 | 路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| POST | `/auth/sign-in` | - | 登录, 返回 7 天有效的 JWT; 同一 IP 15 分钟内失败 10 次会被限流 |
| POST | `/auth/sign-up` | 管理员 | 创建用户 |
| GET | `/meme` | - | 列出 meme, 可选 `?limit=&offset=` 分页 |
| GET | `/meme/rand` | - | 随机一个 meme |
| GET | `/meme/:id` | - | 单个 meme |
| POST | `/meme/post` | 登录 | 上传 (multipart: `title`, `file`), 标题不能重复, 文件最大 20MB |
| DELETE | `/meme/:id` | 作者或管理员 | 删除 |

图片统一转成 WebP 存在 `public/memes/`, 通过 `/memes/<文件名>` 访问。
