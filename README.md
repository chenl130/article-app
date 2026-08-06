# Immigration Article Studio

一个面向美国移民律所的公众号文章生成工作台原型。

## 当前版本

这是带本地后端和 OpenAI API 调用的 MVP 原型，目标是先验证产品流程：

- 创建文章任务
- 设置移民类别、读者、渠道、风格参数
- 生成文章策略
- 生成初稿
- 用按钮执行定向改稿
- 生成律师审阅清单
- 按角色控制批准发布
- 导出 Markdown 稿件
- 保存文章项目和版本
- 恢复历史版本
- 保存知识库素材并注入生成材料

## 启动方式

设置 API key，然后启动本地后端：

```bash
cd /Users/liangchen/Downloads/ai写作/immigration-article-studio
export OPENAI_API_KEY="你的 key"
python3 server.py
```

浏览器打开：

```text
http://127.0.0.1:4173
```

可选环境变量：

```bash
export OPENAI_MODEL="gpt-5.5"
export PORT="4173"
```

## 后端接口

- `GET /api/status`
- `POST /api/articles/strategy`
- `POST /api/articles/draft`
- `POST /api/articles/rewrite`
- `POST /api/articles/review`
- `GET /api/projects`
- `POST /api/projects/save`
- `POST /api/projects/load`
- `GET /api/knowledge`
- `POST /api/knowledge/save`

后端把任务分发给不同 agent：

- Legal Analyst Agent
- Immigration Strategy Agent
- Article Architect Agent
- Draft Writer Agent
- Risk Reviewer Agent
- Style Agent
- Anti-AI Voice Agent
- Final Partner Review Agent
