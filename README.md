# bottle-plugin

适用于 Yunzai/同类插件加载器的漂流瓶插件，目录结构参考 `kis-plugin`。

## 功能

- SQLite 持久化漂流瓶、评论和捡取记录
- Gemini 原生 `generateContent` 审核
- OpenAI 兼容 `/chat/completions` 审核
- Markdown 文本输出
- `segment.button([...])` 按钮输出，不支持按钮时自动退回文字命令
- Vue 3 漂流瓶与评论分页审核管理台
- 配置热加载、锅巴配置和主人命令修改

## 安装

将目录放到机器人根目录的 `plugins/bottle-plugin`：

```bash
cd plugins/bottle-plugin
npm install
```

重启机器人后，插件会自动加载 `apps` 目录中的应用。

## 审核配置

首次启动会从 `default_config/config.json` 自动生成 `config/config.json`。运行时配置已从版本控制中排除，更新插件不会覆盖现有配置。

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
#评论漂流瓶000001内容
#查看评论000001
#我的漂流瓶
#捡回漂流瓶000001
#重新扔漂流瓶000001
#漂流瓶状态
#漂流瓶帮助
```

ID 前后的空格均可省略。每个用户默认每天最多有 5 个漂流瓶审核通过，未通过或等待审核的内容不占额度。

## 管理命令

```text
#漂流瓶配置
#漂流瓶配置帮助
#漂流瓶配置 设置 <配置项> <值>
```

## 锅巴配置

插件根目录包含 `guoba.support.js`。安装锅巴插件后，可配置审核服务、API Key、每日额度、冷却时间、网页密码、Cookie 有效期和分页条数。

## 审核管理页面

机器人主人发送：

```text
#漂流瓶管理
```

机器人会返回 `/bottle` 管理地址。先通过锅巴、主人命令或配置文件设置 `web.password`，再使用该密码登录。登录后可以：

- 在概览、漂流瓶、评论三个页面间切换
- 查看、搜索和筛选全部漂流瓶
- 分页加载漂流瓶与评论
- 审核通过或拒绝漂流瓶及评论
- 记录并显示自动审核或人工拒绝原因
- 查看评论和最近捡取记录
- 收回或重新投放漂流瓶
- 永久删除漂流瓶或评论

管理会话保存在签名 HttpOnly Cookie 中，默认有效期为 30 天。签名密钥保存在 `data/admin-session.key`，机器人重启后 Cookie 仍然有效；修改管理密码会立即使旧 Cookie 失效。
