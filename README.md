# bottle-plugin

适用于 Yunzai/同类插件加载器的漂流瓶插件，目录结构参考 `kis-plugin`。

## 功能

- SQLite 持久化漂流瓶、评论和捡取记录
- Gemini 原生 `generateContent` 审核
- OpenAI 兼容 `/chat/completions` 审核
- Markdown 文本输出
- `segment.button([...])` 按钮输出，不支持按钮时自动退回文字命令
- 配置热加载和主人命令修改

## 安装

将目录放到机器人根目录的 `plugins/bottle-plugin`：

```bash
cd plugins/bottle-plugin
npm install
```

重启机器人后，插件会自动加载 `apps` 目录中的应用。

## 审核配置

编辑 `config/config.json`，或使用主人命令：

```text
#漂流瓶配置 设置 moderation.provider gemini
#漂流瓶配置 设置 moderation.gemini.apiKey YOUR_KEY
```

OpenAI 或兼容服务：

```text
#漂流瓶配置 设置 moderation.provider openai
#漂流瓶配置 设置 moderation.openai.apiKey YOUR_KEY
#漂流瓶配置 设置 moderation.openai.baseUrl https://api.openai.com/v1
#漂流瓶配置 设置 moderation.openai.model gpt-4.1-mini
```

`moderation.failPolicy` 可设为：

- `pending`：审核服务异常时保留为待人工审核
- `reject`：审核服务异常时直接拒绝

## 用户命令

```text
#扔漂流瓶 内容
#捡漂流瓶
#评论漂流瓶 000001 内容
#查看评论 000001
#我的漂流瓶
#捡回漂流瓶 000001
#重新扔漂流瓶 000001
#漂流瓶状态
#漂流瓶帮助
```

## 管理命令

```text
#漂流瓶配置
#漂流瓶配置帮助
#漂流瓶配置 设置 <配置项> <值>
```

## 锅巴配置

插件根目录包含 `guoba.support.js`。安装锅巴插件后，可在锅巴管理页面中配置审核服务、API Key、数量限制、冷却时间和消息输出。

## 审核管理页面

机器人主人发送：

```text
#漂流瓶管理
```

机器人会生成一个 5 分钟内有效、仅可使用一次的 `/bottle` 登录链接。登录后可以：

- 查看、搜索和筛选全部漂流瓶
- 审核通过或拒绝漂流瓶及评论
- 查看评论和最近捡取记录
- 收回或重新投放漂流瓶
- 永久删除漂流瓶或评论

管理会话保存在 HttpOnly Cookie 中，有效期为 12 小时。
