# Recordly 黑色剪影个人版项目归档

归档日期：2026-07-24

## 项目定位

- 上游仓库：`webadderallorg/Recordly`
- 固定上游基线：`360b1605009b1c9439629bfaf2033c59f94c611b`
- 功能分支：`codex/recordly-silhouette`
- 目标平台：当前用户的 Apple Silicon macOS 个人环境
- 源码许可：保留上游 AGPL-3.0、版权归属和第三方许可

## 已完成范围

- 人物效果保持“原始画面 / 黑色剪影”两个状态。
- 黑色剪影将人物区域渲染为纯黑，背景透明，不保留肤色、五官或衣服纹理。
- 剪影状态叠加白色椭圆眼睛、黑色瞳孔和白色露齿笑嘴。
- MediaPipe 人物分割与面部定位模型、WASM 均随应用本地打包，不上传摄像头画面。
- 头像元素根据面部位置、缩放、角度、镜像和裁剪进行确定性布局；人物丢失时平滑隐藏。
- 预览、编辑器回放、MP4 渲染与 GIF 渲染复用同一效果设置和帧时间逻辑。
- 项目保存和恢复会持久化剪影状态；旧项目默认使用原始画面。
- 剪影处理失败时导出会中止，不会回退并泄漏原始摄像头人物。
- macOS 应用使用独立标识 `dev.recordly.silhouette.personal`，并为本地重复构建保持稳定的指定要求。
- 启动时不再反复主动打开系统设置；实际捕获后端负责验证录屏权限。

## 可运行交付

- 构建产物：`release/mac-arm64/Recordly.app`
- 当前机器安装路径：`/Applications/Recordly Silhouette.app`
- 当前机器只应从 `/Applications/Recordly Silhouette.app` 启动，避免重新触发旧构建路径的 TCC 缓存。
- 安装包为个人环境使用的 ad-hoc 签名 arm64 应用，不是公证后的公开发行包。

## 验证证据

- 完整测试：110 个测试文件、1074 个测试通过。
- 权限回归测试：2 个测试文件、112 个测试通过。
- TypeScript：`npx tsc --noEmit` 通过。
- Web 构建：`npx vite build --config vite.config.ts` 通过。
- Electron 主进程 CJS 规范化与 smoke test 通过。
- arm64 打包：`npx electron-builder --mac dir:arm64` 通过。
- 签名检查：`codesign --verify --deep --strict` 通过。
- 实机权限：Recordly 已出现在“录屏与系统录音”列表，开关为开启。
- 实机重启：从安装路径完整退出并重启后，没有再次出现权限缺失循环。
- 实机录制：完成约 13.6 秒短录屏并正常进入 Recordly 编辑器。

## GitHub 归档边界

可以把源码功能分支上传到用户自己的 GitHub fork，但必须：

- 保留 `LICENSE.md`、上游版权归属与 `public/licenses/` 中的第三方许可。
- 公开派生源码时继续遵守 AGPL-3.0。
- 不把 fork 直接描述为上游官方发行版，也不创建未经上游授权的官方品牌发布。
- 不提交 `release/`、`dist/`、`dist-electron/`、安装后的 `.app`、本地录屏或项目文件。
- 不提交构建过程中被本机工具链重写的 `electron/native/bin/darwin-*` 二进制。
- 只推送 `codex/recordly-silhouette` 功能分支，不直接推送或改写上游 `main`。

## 已知限制

- 真实 MP4 与 GIF 文件的最终人工视觉对比样例尚未随本归档保存；共享渲染路径和失败保护已有自动化测试覆盖。
- 当前交付只覆盖 arm64 macOS；Intel、公开签名、公证与 Release 发布不在本次范围内。
- ad-hoc 签名版本适合当前机器个人使用。面向他人分发前仍需独立品牌、正式签名、公证和完整发布合规检查。
