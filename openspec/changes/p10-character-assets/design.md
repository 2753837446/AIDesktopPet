# 技术设计

## 数据

migration v7 增加 `character_assets`：

- id、display_name、view、mime_type、width、height、size_bytes、file_path、created_at。
- 二进制文件保存在 `userData/character-assets/`。
- SQLite 只保存元数据和受控文件引用。

## 校验

- 最大 10 MiB。
- 允许 PNG、GIF、WebP；拒绝 SVG 和任意脚本格式。
- 通过文件魔数识别真实类型，不信任扩展名和 MIME。
- 最大 4096×4096。
- 文件名不直接作为写入路径，使用 UUID。

## UI

- 上传后生成新资产并自动选中。
- 图片以 Blob URL 显示，不把 data URL 写入 settings。
- 可切回内置角色或删除自定义资产。
- 上传时可标记 front/left/right/back/idle/talking/thinking 等视图。

## Character Runtime

统一角色状态：idle、talking、thinking、dragging、happy、sleepy。
当前实现为 static/animated image adapter；后续可增加 sprite-sheet、rigged-2d、gltf-3d adapter。
