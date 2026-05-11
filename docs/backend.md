# 后端说明

## 总体职责

后端承担四类工作：

1. 页面渲染
2. JSON API 与媒体输出
3. 长任务调度
4. 数据库与本地文件系统协调

---

## 路由层

### `web/routes/pages.py`

负责页面渲染：

- `/`
- `/tag`
- `/filter`
- `/map`
- `/settings`
- `/tools`
- `/tools/duplicates`

它依赖：

- `web/common.py` 的模板对象
- `web/services/gallery.py`
- `web/services/settings.py`
- `web/state.py`
- `duplicates.py`

### `web/routes/api.py`

负责数据接口和媒体接口：

- `/api/groups`
- `/api/position`
- `/api/dates`
- `/api/map`
- `/api/map/cell`
- `/api/groups/{id}`
- `/api/tags`
- `/media/{id}`
- `/thumbs/{id}.jpg`
- `/previews/{id}.jpg`

它依赖：

- `web/services/gallery.py`
- `web/services/media.py`
- `db.py`
- `media.py`
- `models.py`

### `web/routes/settings.py`

负责 profile 和数据库相关操作：

- 切换 profile
- 创建 profile
- 移动数据库
- 删除数据库
- 触发扫描
- 默认数据库路径 API
- 选择目录 API

它依赖：

- `config.py`
- `db.py`
- `web/services/settings.py`
- `web/tasks/album_scan.py`
- `web/state.py`

### `web/routes/tools.py`

负责去重工具行为：

- 启动重复分析
- 查询重复分析状态
- 单组删除
- 全库智能删除
- 单文件移动到隔离区

它依赖：

- `duplicates.py`
- `web/services/duplicates.py`
- `web/tasks/duplicate_scan.py`
- `web/state.py`

---

## 服务层

### `web/services/gallery.py`

这是目前最重要的 service。

职责包括：

- group 查询
- tag 查询
- 日期计数
- 日期跳转
- 地图边界内 group 查询
- 地图格子聚合
- group payload 组装
- 统一的“有效时间”逻辑

它是多个路由文件共同依赖的中心模块。

### `web/services/settings.py`

职责：

- 数据库是否可用检查
- 需要跳过数据库检查的路径判断
- 默认数据库路径生成
- 删除 SQLite 相关附属文件
- Windows 文件夹选择器
- profile 信息结构化输出

### `web/services/media.py`

职责：

- 生成支持 Range 的视频响应

### `web/services/duplicates.py`

职责：

- 去重删除动作互斥保护
- 去重消息格式化

它不做判重本身，而是做“高风险动作编排”。

---

## 任务层

### `web/tasks/album_scan.py`

职责：

- 启动相册扫描线程
- 更新扫描状态
- 驱动 `importer.py`

### `web/tasks/duplicate_scan.py`

职责：

- 启动重复分析线程
- 更新重复分析状态
- 驱动 `duplicates.py`

---

## 根层核心模块

### `config.py`

职责：

- 读取配置文件
- 维护多个 profile
- 提供当前激活 profile
- 提供相册路径、数据库路径、缩略图路径等

### `db.py`

职责：

- 定义数据库引擎和 session
- 切换 active profile 对应数据库
- 初始化数据库表

### `models.py`

当前主要模型：

- `AssetGroup`
- `AssetResource`
- `Tag`
- `AssetTag`

关系核心：

- 一个 `AssetGroup` 对应多个 `AssetResource`
- 一个 `AssetGroup` 可对应多个 `Tag`

### `importer.py`

职责：

- 遍历相册目录
- 识别资源
- 建立或更新 group/resource
- 生成缩略图

### `media.py`

职责：

- 生成图片缩略图
- 生成视频缩略图
- 生成浏览器可显示的完整预览图

### `duplicates.py`

职责：

- 构建重复缓存数据库
- 计算文件哈希 / 像素哈希
- 列出重复组
- 判断整组资源是否相同
- 将文件移动到隔离区

这是当前最重的底层能力模块之一。

---

## 依赖关系简图

```text
main.py
  -> web/routes/*
      -> web/services/*
      -> web/tasks/*
      -> db.py / config.py / models.py
      -> importer.py / media.py / duplicates.py
```

更具体一点：

```text
pages/api/settings/tools routes
  -> gallery/settings/media/duplicates services
  -> scan tasks
  -> root domain modules
```

---

## 当前后端演进建议

如果继续整理后端，优先建议：

1. 清理历史乱码文案
2. 给 `duplicates.py` 继续拆层
3. 给 `importer.py` 继续拆层
4. 把常用返回 payload 逐步收敛成 schema 或 dataclass
