# Speech Coach AI

Speech Coach AI 是一个本地优先的演讲、路演和主持陪练工具。它把台词卡、语音听众、摄像头录像、表达时间轴和知识库放在同一个练习工作台里。

## 能做什么

- 投资人 Pitch：模拟市场、壁垒、商业模式和融资问题。
- 客户路演：模拟 ROI、交付、数据安全和采购异议。
- 线下演讲：练习开场、故事、互动、转场和收尾。
- 完整台词、提纲和隐藏台词三种提词模式。
- 摄像头与麦克风本地录制，录像保存在浏览器 IndexedDB。
- 浏览器内计算语速、音量、面向镜头比例、手势活动和身体晃动。
- 导入 DOCX、PDF、Markdown、TXT，也可读取授权的飞书文档。
- 配置 OpenAI 后使用低延迟实时语音听众；未配置时自动使用本地模拟与规则复盘。

## 隐私边界

原始录像、摄像头帧和面部/姿态关键点不会发送到应用 API。AI 只接收转写、当前场景、相关知识片段和汇总后的表达指标。视觉反馈只描述可观察行为，不推断心理状态、人格、疾病或是否诚实。

浏览器会从 Google Storage 和 jsDelivr 下载 MediaPipe 模型与运行文件；模型推理发生在浏览器本地。

文档解析同样发生在浏览器内。和其他本地文档工具一样，只导入你信任的文件；应用不会把文件正文自动上传到第三方。

## 本地启动

```bash
npm install
cp .env.example .env.local
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000)。推荐使用桌面版 Chrome，并允许摄像头和麦克风权限。

## OpenAI 配置

在 `.env.local` 中设置：

```bash
OPENAI_API_KEY=your_key
OPENAI_REALTIME_MODEL=gpt-realtime
OPENAI_REVIEW_MODEL=gpt-5-mini
```

API Key 只在 Next.js 服务端路由中使用，不会进入浏览器包。

## 飞书配置

创建飞书企业自建应用，为它开启云文档和知识库只读权限，并确保该应用可访问目标文档。然后设置：

```bash
FEISHU_APP_ID=your_app_id
FEISHU_APP_SECRET=your_app_secret
```

在知识库页面粘贴 `/docx/` 或 `/wiki/` 链接即可导入。服务端仅负责读取并返回标准化正文，不持久化资料。

## 验证

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

首次运行浏览器端到端测试前安装 Playwright Chromium：

```bash
npx playwright install chromium
npm run test:e2e
```

## 数据与开源

`.gitignore` 已排除环境变量、本地资料、录像、转写和私人台本。仓库内的三种示例场景均为通用脱敏内容。

## License

MIT
