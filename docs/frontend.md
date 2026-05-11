# 前端说明

## 总体结构

前端是原生模板 + 原生 JS 模块 + 拆分后的 CSS。

设计原则是：

- 模板保持稳定
- 页面逻辑按模块拆分
- 样式按页面和功能拆分
- 尽量通过 `data-*` 选择器连接 DOM 和脚本

---

## JS 结构

### `static/app.js`

职责：

- 统一初始化所有页面模块
- 处理全局事件委托
- 在不同页面之间复用一套预览 / 标签交互逻辑

它是前端入口，不再承载全部业务细节。

### `static/js/core/shared.js`

职责：

- 存放共享状态
- 提供通用工具函数
- 提供跨模块公共常量

主要内容：

- `groupCache`
- `previewState`
- `taggerState`
- `homeState`
- `mapState`
- `mapCellState`
- `MAP_TILE_PROVIDERS`
- HTML 转义、日期处理、地图坐标转换等小工具

### `static/js/features/`

#### `preview.js`

负责：

- 大图预览 modal
- live 长按播放
- 缩放、拖动、切换上一张下一张
- 原图/资源下载

#### `tags.js`

负责：

- 调用标签增删 API
- 刷新标签库
- 渲染当前标签列表

#### `date-strip.js`

负责：

- 横向日期条
- 日期桶压缩
- 鼠标滚动 / 拖动
- 当前选中日期同步

### `static/js/pages/`

#### `home.js`

负责：

- 首页无限流加载
- 月分隔插入
- 右侧纵向时间轴
- 首页与时间轴同步

#### `tagger.js`

负责：

- 打标签页数据窗口
- 上一张/下一张
- 复制上一张标签
- 标签页内 live 播放

#### `map.js`

负责：

- 地图瓦片渲染
- 地图缩放拖拽
- 地图格子聚合
- 点击格子后弹板
- 弹板内预览与标签操作

#### `settings.js`

负责：

- 设置页表单辅助
- 默认数据库路径联动
- 目录选择按钮
- 扫描状态轮询

#### `tools.js`

负责：

- 去重工具状态轮询
- 提交后锁按钮，防重复点击

---

## CSS 结构

### `static/app.css`

职责：

- 样式总入口
- 通过 `@import` 聚合分模块样式

### `static/css/base.css`

通用样式：

- 全局变量
- topbar
- 基础按钮、chip、表单控件
- 通用 gallery 卡片
- 日期条基础样式
- pager、empty state

### `static/css/home.css`

首页特有：

- 无限流布局
- 月分隔
- 右侧纵向时间轴

### `static/css/tagger.css`

打标签页特有：

- 左右布局
- 图片舞台
- 标签面板

### `static/css/preview.css`

预览 modal 特有：

- modal 布局
- 缩放视图
- 资源下载区

### `static/css/map.css`

地图页特有：

- 地图画布
- marker 气泡
- 地图弹板

### `static/css/settings.css`

设置页特有：

- profile 卡片
- 扫描状态
- 数据库移动/删除表单

### `static/css/tools.css`

工具页特有：

- 重复组列表
- 工具箱卡片
- 防重复提交状态

### `static/css/responsive.css`

窄屏响应式规则统一放在这里。

---

## 模板与前端的连接方式

前端主要依赖以下 DOM 契约：

1. `data-*` 属性
2. 页面根节点上的 `dataset`
3. 固定的 class 名

比如：

- `data-home-gallery-root`
- `data-map`
- `data-duplicate-status`
- `data-open-preview`
- `data-busy-lock-form`

所以后续如果改模板，最应该谨慎的是这些选择器和 dataset。

---

## 当前前端演进建议

如果继续整理前端，优先建议：

1. 继续清理部分历史乱码文案
2. 给共享 API 请求加统一封装
3. 给 `app.js` 的全局事件分发再做一次精简
4. 视情况把模板里的部分重复片段抽成 partial
