# 关键流程

## 1. 相册扫描与索引更新

流程：

1. 用户在设置页触发扫描，或应用启动时自动尝试扫描
2. `main.py` 启动后调用 `start_album_scan()`
3. `web/tasks/album_scan.py` 启动后台线程
4. 后台线程调用 `importer.py`
5. `importer.py` 遍历相册目录、更新 `AssetGroup / AssetResource`
6. `media.py` 负责生成缩略图
7. 扫描状态写回 `web/state.py`
8. 设置页前端轮询 `/api/settings/scan-status`

依赖链：

```text
settings page
  -> /settings/scan
  -> web/tasks/album_scan.py
  -> importer.py
  -> media.py
  -> db/models
```

---

## 2. 首页无限流浏览

流程：

1. 页面 `/` 渲染 `index.html`
2. 前端 `home.js` 初始化首页状态
3. 前端请求 `/api/groups`
4. 后端 `web/routes/api.py` 调用 `web/services/gallery.py`
5. `gallery.py` 查询数据库并返回 group payload
6. 前端将结果插入流式画廊

依赖链：

```text
index.html
  -> static/js/pages/home.js
  -> /api/groups
  -> web/routes/api.py
  -> web/services/gallery.py
  -> db/models
```

---

## 3. 日期时间轴跳转

流程：

1. 首页或打标签页请求 `/api/dates`
2. 后端返回每天的计数
3. 前端将日期压缩为 5 天桶
4. 用户点击或拖动时间轴
5. 前端请求 `/api/position`
6. 后端计算最近日期对应的 offset
7. 前端跳转到相应位置

依赖链：

```text
timeline UI
  -> /api/dates
  -> gallery.date_counts()
  -> /api/position
  -> gallery.resolve_offset_for_date()
```

---

## 4. 打标签

流程：

1. 打标签页加载 group 窗口
2. 用户点击已有标签或输入新标签
3. 前端调用 `/api/groups/{id}/tags`
4. 后端创建或复用 `Tag`
5. 后端维护 `AssetTag`
6. 返回更新后的 group payload
7. 前端刷新当前标签和标签库

依赖链：

```text
tagger.js / tags.js
  -> /api/groups/{id}/tags
  -> web/routes/api.py
  -> db/models
```

---

## 5. 地图浏览

流程：

1. 页面 `/map` 渲染地图基础参数
2. 前端 `map.js` 根据当前视野请求 `/api/map`
3. 后端 `gallery.map_groups_for_bounds()` 查出视野内带坐标的 group
4. 后端 `gallery.map_grid_payload()` 聚合为格子
5. 前端渲染气泡
6. 点击气泡时请求 `/api/map/cell`
7. 后端返回该格子内全部 group
8. 前端弹出格子面板并允许预览/打标签

依赖链：

```text
map.js
  -> /api/map
  -> gallery.map_groups_for_bounds()
  -> gallery.map_grid_payload()

map.js
  -> /api/map/cell
  -> gallery.map_cell_position()
```

---

## 6. 大图预览与 Live

流程：

1. 任意页面点击缩略图
2. 前端 `preview.js` 打开 modal
3. 若 group 未带完整 resources，则请求 `/api/groups/{id}`
4. 若资源是可直接显示图片，直接加载
5. 若是浏览器不支持的图片格式，则请求 `/previews/{id}.jpg`
6. 若是视频，走 `/media/{id}`，支持 Range 流式播放
7. 若是 Live，长按显示视频层

依赖链：

```text
preview.js
  -> /api/groups/{id}
  -> /media/{id}
  -> /previews/{id}.jpg
  -> media.py / web/services/media.py
```

---

## 7. 重复分析

流程：

1. 用户在工具页点击开始分析
2. `web/tasks/duplicate_scan.py` 启动后台线程
3. 后台线程调用 `duplicates.py`
4. `duplicates.py` 读取图片资源，建立重复缓存
5. 计算：
   - 文件哈希
   - 像素哈希
6. 前端轮询 `/api/tools/duplicates/status`
7. 分析完成后，工具页刷新显示重复组

依赖链：

```text
tools page
  -> /tools/duplicates/scan
  -> web/tasks/duplicate_scan.py
  -> duplicates.py
  -> duplicate_cache.sqlite
```

---

## 8. 智能删除重复

流程：

1. 用户在去重页发起删除
2. 路由进入 `web/routes/tools.py`
3. 删除动作经过 `web/services/duplicates.py` 的互斥保护
4. 调用 `duplicates.py` 执行：
   - 判断是否纯图片重复
   - 判断伴生资源是否完全一致
   - 判断应保留最早的一组还是只删除纯图片项
5. 文件移动到隔离区
6. 数据库记录同步清理

依赖链：

```text
tools.js
  -> /tools/duplicates/...
  -> web/routes/tools.py
  -> web/services/duplicates.py
  -> duplicates.py
  -> duplicate_quarantine
```

---

## 当前最重要的状态源

### 后端状态

- `web/state.py`
  - `scan_status`
  - `duplicate_status`

### 前端状态

- `static/js/core/shared.js`
  - `previewState`
  - `taggerState`
  - `homeState`
  - `mapState`
  - `mapCellState`

理解这些状态对象，基本就能快速进入维护状态。
