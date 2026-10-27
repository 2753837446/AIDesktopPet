# 技术设计

## 资产加工

源文件：用户提供的角色设定 JPG，原尺寸 1672×941。

可复现脚本：

```text
scripts/prepare-character-preset.py
  -> 按视角裁切
  -> 连通背景提取
  -> 清理设定卡文字/缩略图残片
  -> Alpha 模糊羽化
  -> 去除透明边并保留安全 padding
  -> 输出 PNG
```

输出：

```text
resources/character-presets/su-qingyue/
  preset.json
  source-profile.jpg
  front.png
  side.png
  back.png
```

不使用生成模型重绘，避免身份、服装和画风漂移。

## 数据模型

migration v10 为 `character_assets` 增加：

- `preset_key TEXT`：内置预设稳定键。
- 部分唯一索引：非空 `preset_key` 唯一。

角色预设导入仍使用受控图片校验和 UUID 文件存储。`preset_key` 只用于幂等，不参与文件路径。

## 运行时导入

`BundledCharacterPresetService`：

1. 读取并 zod 校验 `preset.json`。
2. 对每个视图读取图片，经 `CharacterAssetService.importPreset` 导入。
3. 已存在同一 `presetKey` 时返回现有资产。
4. 返回正面资产及是否为首次导入。

资源路径：

- packaged：`process.resourcesPath/character-presets/...`
- development：`app.getAppPath()/resources/character-presets/...`

`electron-builder.yml` 使用 `extraResources` 打包，不把图片塞进 asar。

## 设置初始化

- `customCharacterId=null` 时选择预设正面。
- 仅当人格仍为 `preset=azure`、姓名仍为“阿湛”时，应用设定图中的姓名、描述和语气。
- 用户已有角色、人格或导入失败时不阻断应用启动；记录错误并继续内置角色。

## 验收

- 单元测试验证幂等、视图和默认初始化逻辑。
- 脚本验证三张 PNG 含 alpha、非空主体、无源文字残留。
- Electron E2E 使用真实预设导入并截图。
- packaged smoke 验证 extraResources 路径和重新导入。
