# 技术设计

## 架构

```text
Settings UI
  -> 确认参考图 + 姿态描述 + 云端处理/计费提示
  -> IPC generate-character-pose
CharacterPoseDirector
  -> CharacterAssetService.read(sourceAssetId)
  -> CharacterImageEditProvider.edit(image, instruction)
  -> 校验并保存为新 CharacterAsset
  -> 返回候选资产，不修改 appearance.customCharacterId
```

`CharacterImageEditProvider` 与聊天模型隔离。图像模型只接收单张参考图、固定保真模板和用户姿态描述，不接收会话、记忆或凭据。

## Provider

- 服务：SiliconFlow `POST https://api.siliconflow.cn/v1/images/generations`。
- 模型：`Qwen/Qwen-Image-Edit-2509`。
- 请求字段：`model`、`prompt`、`image`（data URL）。
- 编辑模型不使用 `image_size`。
- 返回结构运行时校验为 `images[0].url`；URL 只接受公网 HTTPS，并立即下载。
- 不关闭平台显式 AI 水印，因为生成头像用于直接展示，属于最终输出。
- URL、HTTP 状态码和原始响应正文不写入普通日志。

## 数据迁移 v8

重建 `character_assets` 以扩展 MIME 约束并加入来源字段：

- `origin`：`upload` 或 `ai_generated`。
- `source_asset_id`：生成参考资产 ID；上传资产为空。
- `generation_prompt`：用户确认过的姿态描述。
- `generation_model`：实际生图模型。
- `generated_at`：外部生成完成时间。
- MIME 增加 `image/jpeg`，用于兼容图像编辑服务可能返回的 JPEG。

旧数据迁移为 `origin=upload`。生成链路由应用层校验，源资产删除后派生资产仍可独立展示。

## 超时、取消和错误

- 单次生成总超时 120 秒，结果下载共享同一取消信号。
- 同一时间只允许一个付费生成任务。
- 取消调用 AbortController；已产生但未下载完成的结果视为不确定，不自动重试。
- 稳定错误码：
  - `CHARACTER_POSE_NOT_CONFIGURED`
  - `CHARACTER_POSE_SOURCE_NOT_FOUND`
  - `CHARACTER_POSE_SOURCE_UNSUPPORTED`
  - `CHARACTER_POSE_BUSY`
  - `CHARACTER_POSE_TIMEOUT`
  - `CHARACTER_POSE_CANCELLED`
  - `CHARACTER_POSE_RATE_LIMITED`
  - `CHARACTER_POSE_PROVIDER_UNAVAILABLE`
  - `CHARACTER_POSE_INVALID_RESPONSE`
  - `CHARACTER_POSE_RESULT_UNSAFE`
  - `CHARACTER_POSE_IMAGE_INVALID`
  - `CHARACTER_POSE_STORAGE_FAILED`

## UI

- “AI 姿态”区域仅在已有自定义形象时可用。
- 第一次点击只生成本地确认卡，不调用 API。
- 确认卡显示当前参考角色、姿态描述、模型、云端处理、可能产生费用和“先预览、后切换”说明。
- 生成期间显示进度与取消按钮。
- 成功后显示候选预览和“设为桌宠”；资产画廊用“AI 姿态”标识来源。
- 失败时不改变当前桌宠，并提供重试入口。

## 安全与演进

- 用户姿态描述限制长度，作为数据放入固定模板，不作为系统指令。
- 生成图、输出 URL 和外部响应均为不可信输入。
- 图片中的文字、网页或提示注入不能触发工具、权限或文件操作。
- 后续可从一个已确认姿态继续编辑，形成动作资产链；多视图用于 2D 转向和建模参考，不能替代骨骼/GLB。
