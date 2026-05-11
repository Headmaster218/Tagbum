# 目录与职责

## 顶层目录

### `Tagbum/`

主程序代码目录。

### `docs/`

项目文档目录。

### `scripts/`

启动脚本等辅助脚本。

### `data/`

运行时数据目录，通常包含：

- SQLite 数据库
- 缩略图
- 服务日志
- 重复文件隔离区

---

## `Tagbum/` 目录结构

### 入口与基础模块

- `main.py`
  - FastAPI 应用入口
- `cli.py`
  - 命令行入口
- `config.py`
  - 配置和 profile 管理
- `db.py`
  - 数据库连接与 session
- `models.py`
  - SQLAlchemy 数据模型

### 核心能力模块

- `importer.py`
  - 扫描本地相册目录并写入数据库
- `media.py`
  - 生成缩略图和浏览器可展示的预览图
- `duplicates.py`
  - 重复分析缓存、重复判定、隔离区移动

### Web 分层目录

- `web/common.py`
  - 模板对象、基础路径
- `web/constants.py`
  - 页大小等共享常量
- `web/state.py`
  - 扫描状态、重复分析状态、锁

#### `web/routes/`

- `pages.py`
  - 返回 HTML 页面
- `api.py`
  - 返回 JSON 或媒体内容
- `settings.py`
  - profile、数据库路径、扫描触发等设置操作
- `tools.py`
  - 去重工具相关操作

#### `web/services/`

- `gallery.py`
  - 相册查询、日期跳转、地图聚合、group payload 组装
- `settings.py`
  - 数据库和 profile 的辅助逻辑
- `media.py`
  - 视频 Range 播放响应
- `duplicates.py`
  - 重复删除动作封装

#### `web/tasks/`

- `album_scan.py`
  - 相册扫描后台任务
- `duplicate_scan.py`
  - 重复分析后台任务

---

## 前端目录结构

### `static/app.js`

前端入口文件，负责：

- 初始化各页面模块
- 绑定全局事件委托

### `static/js/core/`

- `shared.js`
  - 全局共享状态
  - 小型通用工具函数
  - 公共数据结构

### `static/js/features/`

- `preview.js`
  - 大图预览、live、缩放、拖动
- `tags.js`
  - 标签增删和标签库刷新
- `date-strip.js`
  - 横向日期条

### `static/js/pages/`

- `home.js`
  - 首页无限流与右侧时间轴
- `tagger.js`
  - 打标签页
- `map.js`
  - 地图页和地图弹板
- `settings.js`
  - 设置页交互
- `tools.js`
  - 去重工具页轮询与表单锁定

### `static/app.css`

样式聚合入口文件。

### `static/css/`

- `base.css`
  - 站点通用样式
- `home.css`
  - 首页与右侧时间轴
- `tagger.css`
  - 打标签页
- `preview.css`
  - 大图预览 modal
- `map.css`
  - 地图页与地图弹板
- `settings.css`
  - 设置页
- `tools.css`
  - 工具箱与去重页
- `responsive.css`
  - 移动端和窄屏响应式规则

---

## 模板结构

### 主模板

- `templates/base.html`

职责：

- 顶部导航
- 主内容块
- 静态资源入口引用

### 页面模板

- `index.html`
- `tag.html`
- `filter.html`
- `map.html`
- `settings.html`
- `tools_index.html`
- `tools.html`

### 局部模板

- `_card.html`
- `_pager.html`

当前模板尚未继续拆细，后续如页面结构继续膨胀，可再引入 `partials/`。
