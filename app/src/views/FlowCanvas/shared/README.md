# shared/
FlowCanvas 内部跨子模块共享的组件（v5 改写：不再是空占位）

- CanvasHeader.vue: 被 canvas/FlowBoard + result/FileView + result/ResultView + result/TaskView 四处引用

**迁移原则**：只有被 2+ 个子目录引用的代码才放这里，避免把 shared/ 当垃圾桶。
**依赖**：无（不依赖任何兄弟子目录，这是它能被安全共享的前提）
**被依赖**：canvas/, result/
