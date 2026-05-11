# 架构总览

## 目标

Tagbum 是一个本地相册管理工具，核心目标是：

- 从本地相册目录建立数据库索引
- 用网页完成浏览、打标签、按标签筛选、地图查看、去重等操作
- 尽量不改动源文件，风险操作优先走隔离区

当前架构是典型的单机 Web App：

- 后端：Python + FastAPI
- 前端：原生 HTML + CSS + JavaScript 模块
- 数据库：SQLite
- 静态资源：本地文件系统

---

## 分层

系统目前大体分成四层：

### 1. 入口层

- `Tagbum/main.py`

职责：

- 创建 FastAPI 应用
- 挂载静态资源
- 注册中间件和异常处理
- 注册所有路由

这一层尽量薄，不承载业务细节。

### 2. 路由层

- `Tagbum/web/routes/`

职责：

- 接收 HTTP 请求
- 解析参数
- 调用 service / task / domain 逻辑
- 返回模板或 JSON

目前分为：

- `pages.py`：页面渲染
- `api.py`：JSON API、媒体接口
- `settings.py`：设置与 profile 管理
- `tools.py`：工具页与去重工具动作

### 3. 服务层

- `Tagbum/web/services/`

职责：

- 承载“可复用的后端业务逻辑”
- 避免把查询、分页、地图计算、删除策略写死在路由里

目前分为：

- `gallery.py`：相册查询、分页、地图、日期相关逻辑
- `settings.py`：数据库存在性检查、默认路径、文件夹选择等
- `media.py`：视频 Range 流式响应
- `duplicates.py`：重复删除动作的保护与消息拼装

### 4. 长任务层

- `Tagbum/web/tasks/`

职责：

- 管理扫描和重复分析这种后台线程任务
- 维护运行状态

目前分为：

- `album_scan.py`
- `duplicate_scan.py`

---

## 仍保留在根目录的模块

有一些模块虽然不是 `web/` 下的，但仍然是系统核心：

- `config.py`：配置读取、profile 管理
- `db.py`：SQLAlchemy 初始化与 session
- `models.py`：数据库模型
- `importer.py`：导入相册目录、写入索引
- `media.py`：缩略图与预览图生成
- `duplicates.py`：重复图片分析、缓存、隔离区操作
- `cli.py`：命令行入口

这些模块更像底层能力层，当前由 `web/` 上层调用。

---

## 前端结构

前端已经从单一大文件拆成模块化结构：

- `Tagbum/static/app.js`：前端总入口
- `Tagbum/static/js/core/`：共享状态与公共工具
- `Tagbum/static/js/features/`：跨页面复用的功能块
- `Tagbum/static/js/pages/`：具体页面逻辑
- `Tagbum/static/css/`：按页面和功能拆分的样式文件

模板仍然只引用：

- `/static/app.js`
- `/static/app.css`

这样模板层足够稳定，内部结构可以继续演进。

---

## 当前的设计原则

现在这套结构默认遵循以下原则：

1. 路由只做装配，不做重逻辑
2. 共享逻辑尽量放在 service / feature 模块里
3. 风险操作优先隔离，不直接永久删除
4. 尽量保持模板、接口路径、数据库结构稳定
5. 先拆责任边界，再考虑进一步抽象

---

## 后续推荐方向

当前拆分已经能支撑继续开发，后面优先建议做的是：

1. 清理部分历史乱码文案
2. 为主要页面补一份人工回归清单
3. 给高风险工具补恢复/回滚说明
4. 为 YOLO 自动打标签单独预留一个工具模块

如果继续做更深层的架构演进，比较自然的方向是：

- 给 `duplicates.py` 再拆成分析层和执行层
- 给 `importer.py` 再拆成扫描、元数据提取、缩略图生成三块
- 为前端共享 API 再补一个统一封装层
