# 小雪助手

登录学生端后，可从公共页面右下角打开小雪助手；沉浸式实训页面隐藏入口。支持四种点击动作、三个快捷问题、普通问答、失败重试与关闭后重开。对话仅保存在当前页面内存，退出登录或离开助手挂载范围时清空，不写入浏览器存储。

管理后台的“小雪助手设置”提供开关、名称、欢迎语、左右位置、外观预览和模型连接测试。保存成功后重新读取服务端配置，刷新学生端生效。设置使用已有 `SystemSetting` 的 `assistant_config` 键，无新增数据库表或迁移。并发修改返回版本冲突，需重新读取后保存。

## 模型配置

仅在服务端受限环境配置以下变量；本地开发使用被 Git 忽略的 `server/.env`，Compose 使用已有的私有 `ENV_FILE`。

```dotenv
ASSISTANT_MODEL_BASE_URL=https://api.deepseek.com
ASSISTANT_MODEL_NAME=deepseek-flash
ASSISTANT_MODEL_API_KEY=
```

`deepseek-flash` 是 DeepSeek-V4.1-Flash 的 API 名称，见 [DeepSeek 官方模型说明](https://api-docs.deepseek.com/quick_start/pricing/)。填入有效密钥并重启后端后，在后台点击“测试连接”。模型地址必须使用 HTTPS，管理界面只读展示地址、名称与配置状态，任何接口都不返回密钥。

问答通过 OpenAI 兼容的 `/chat/completions` 调用，使用非流式、非思考模式，超时 30 秒、最多输出 1024 tokens。每次最多 20 条上下文消息，每条最多 4000 字符；学生输入框限制 2000 字符。问答和连接测试共用每账号每分钟 12 次的数据库限流。模型未配置、认证失败、余额不足、限流、超时或空回答均明确提示，不回退到预设回复。

## 接口与权限

| 方法与路径（前缀 `/api/v1`） | 权限 | 用途 |
| --- | --- | --- |
| `GET /assistant/config` | 已登录 | 读取外观与开关 |
| `POST /assistant/chat` | 已登录 | `{messages:[{role,content}]}` → `{reply}` |
| `GET /admin/assistant/config` | `settings.read` | 读取设置、版本与模型状态 |
| `PATCH /admin/assistant/config` | `settings.write` | 保存设置，附带 `expectedRevision` |
| `POST /admin/assistant/test` | `settings.write` | 实际调用模型并返回 `{ok,message}` |

响应沿用项目业务包装。此功能范围不包含帖子简讯。
