# 智能家居后续设计

## 推荐接入顺序

1. Home Assistant Connector。
2. MQTT / Zigbee2MQTT。
3. Matter / Thread。
4. 厂商云 API。

## 数据对象

```text
Home
  -> Room
  -> Device
     -> Capability
     -> State
  -> Scene
     -> Trigger
     -> Condition
     -> Action
```

## 执行原则

- 场景使用确定性状态机。
- LLM 只生成意图草案和解释。
- 执行前展示影响范围和预期状态。
- 高风险动作二次确认。
- 每次执行写入审计并支持幂等。
