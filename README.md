# 茶茶刷题（Chacha Quiz）

把 Word 题库拆成一道道题，再打乱顺序刷。纯本地、离线，题目和记录都不出这台设备。

网上的题库大多是 Word 文档，格式五花八门：选项挤在一段里、答案写在文末、答案用红字、夹着表格和图片。现成的刷题 App 基本都不认这些，所以先写解析器，再做刷题。

- **解析台**：导入 `.docx`，自动分出题干、选项、答案和解析，每道题带置信度，拿不准的进「待确认」；结果可以导回 JSON
- **刷题**：随机、顺序、只刷错题、限时模拟考，选项打乱，选完立刻判
- **错题本**：答错自动收进来，按错的次数排序，可以一键重刷
- **收藏、标记、跳过**：底部一条工具条，随题记录
- **答题卡**：题号网格，对、错、未答、当前四种状态，点题号直接跳
- **刷题记录**：每组刷完记一条，题量、对错、跳过、用时、正确率都在里面
- **多题库**：本地可以存好几份，切换着用，进度和错题按题库分开算

手机上有两种用法。浏览器打开 `quiz/dist/刷题解析台.html`，单文件、断网可用；或者装 Android 版，安装包放在 Releases，源码是 `quiz-app/` 里的 WebView 壳。

## 目录

```
quiz/              解析台和刷题前端，HTML/JS，无构建、无依赖
  index.html       页面入口
  js/parse.js      docx 解析器，浏览器和 Node 都能跑
  js/quiz.js       刷题引擎：会话、判分、错题、模拟考、记录
  js/app.js        解析台界面和题库管理
  vendor/          JSZip（解 zip 用，单文件版会内嵌）
  samples/         dirty.docx，自造的脏格式样例
  test/            Node 测试和单文件打包脚本
  dist/            单文件版
quiz-app/          Android 壳，WebView 加手工打包脚本
  src/             MainActivity
  res/ art/        图标
  build.sh         打包脚本
```

## 构建

前端不用构建，起个静态服务器就能改：

```sh
cd quiz
python3 -m http.server 8100        # 浏览器打开 http://127.0.0.1:8100/
node test/build-single.js          # 重新打单文件版
node test/verify.js samples/dirty.docx
node test/parse-test.js samples/dirty.docx --all
```

打单文件版时默认内嵌 `samples/dirty.docx`。想换示例就 `node test/build-single.js 你的题库.docx`，不想内嵌就传一个不存在的路径。

APK 需要 Android SDK（build-tools 34 以上，platform 34 或 35）和 JDK 17 以上：

```sh
cd quiz-app && bash build.sh
```

脚本会自动找 SDK，找不到就用 `ANDROID_SDK` 指定；Windows 上在 Git Bash 里跑一样可以。

## 解析器能认什么

- 大节标题（`一、单选题`）、题号（`1.` / `1、` / `第1题` / Word 自动编号）
- 选项：`A.` / `A、` / `①` / 一行挤多个 / tab 分隔
- 答案：`答案：` / 红字 / 白字 / 隐藏字 / 文末答案清单 / 「题号|答案」表格
- 题干里的表格和图片，以及整张表格形式的题库
- 每道题带置信度和问题标签：无答案、选项不足、答案不在选项里、题号不连续、重复题

## 技术说明

- 解析器直接读 docx 里的 `word/document.xml`，不经过 HTML 中转。XML 解析、样式颜色编号、表格、图片、文本框都是自己实现的
- 判断答案优先看结构信号，段落样式、字符颜色、隐藏属性、`numbering.xml` 里的真实编号，字符串规则只做兜底；每条规则给置信度，低分题进「待确认」而不是硬猜
- 数据只存在本地。网页版用 `localStorage`，App 里通过 JS 桥写进 `SharedPreferences`
- 页面是单个 HTML，约 230KB，不带框架、不发网络请求

## 仓库里没有什么

- 不带真实题库。`samples/` 里只有自造的 `dirty.docx`，测试用的题库不随仓库分发
- 不带安装包。APK 走 Releases，`.gitignore` 里已经排除了 `*.apk`

## 许可

MIT
