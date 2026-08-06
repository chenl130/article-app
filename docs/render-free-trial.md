# Render 免费内测部署说明

## 适用目标

用于 1-2 天免费云端内测：

- 中国和美国用户访问同一个 HTTPS 网址
- 验证登录、文章生成、小红书卡片、图片生成、手机端体验
- 不用于长期保存项目、知识库或客户敏感资料

## 免费版限制

Render Free Web Service 会在空闲后休眠，首次打开可能需要等待约 1 分钟。

免费 Web Service 的本地文件系统是临时的，服务重启、重新部署或休眠后，运行时写入的本地文件可能丢失，包括：

- `data/projects.json`
- `data/knowledge.json`
- `generated-images/`

因此免费试用阶段只用于流程验证。正式内测需要付费实例 + 持久磁盘或数据库。

## 准备 GitHub 仓库

建议只上传 `immigration-article-studio` 这个文件夹，不要上传上级目录里的 Word 文档和私人文件。

必须确认不要上传：

- `.env`
- API key
- 客户敏感资料

当前 `.gitignore` 已包含 `.env` 和 `generated-images/`。

## Render 创建服务

1. 登录 Render。
2. New → Web Service。
3. 连接 GitHub 仓库。
4. Root Directory 填：

```text
immigration-article-studio
```

如果仓库本身只包含 app 文件，则 Root Directory 留空。

5. Environment 选择 Python。
6. Build Command 留空。
7. Start Command 填：

```bash
python server.py
```

8. Instance Type 选择 Free。

## 环境变量

在 Render 的 Environment 页面添加：

```text
HOST=0.0.0.0
OPENAI_API_KEY=你的 OpenAI API key
BETA_PASSWORD=你的内测访问密码
OPENAI_MODEL=gpt-5.5
OPENAI_IMAGE_MODEL=gpt-image-1
```

`PORT` 不需要手动设置，Render 会自动提供。

## 部署后测试

打开 Render 提供的 `https://...onrender.com` 地址。

测试顺序：

1. 输入使用者姓名和访问密码。
2. 打开项目库，确认能读取项目。
3. 生成一篇短文章。
4. 生成小红书卡片。
5. 点一张卡片的“生成这张图片”。
6. 用美国和中国网络分别打开同一个网址测试速度。

## 两天测试后判断

如果体验可以，下一步建议升级：

- 付费 Web Service，避免休眠。
- Persistent Disk 或数据库，保存项目和知识库。
- 图片迁移到云存储。
- 用户账号隔离和更细权限。
