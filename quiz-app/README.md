# 茶茶刷题 APK

把 `../quiz` 的单文件版包成 Android App（WebView 壳）。

## 构建

```sh
bash build.sh
```

产物：`build/茶茶刷题.apk`（约 286KB，minSdk 26 / targetSdk 34）。

依赖：`/root/android/sdk`（build-tools 34 + platform-34，x86_64 版用 qemu 跑）、JDK 17、PIL（生成图标）。

## 结构

```
AndroidManifest.xml        清单：com.chacha.quiz，标签「茶茶刷题」
src/com/chacha/quiz/MainActivity.java   WebView 壳
assets/（构建时从 ../quiz/dist/刷题解析台.html 拷成 app.html）
res/mipmap-*               图标（adaptive + 传统）
art/icon.py                图标生成脚本（PIL）
```

## 壳里做的事

- `loadDataWithBaseURL("https://quiz.local/")` 加载单文件页面
- 文件选择：`onShowFileChooser` 起 `ACTION_GET_CONTENT`，让页面里的 `<input type=file>` 能选 docx
- **localStorage 改走 SharedPreferences**：注入脚本把 `window.localStorage` 换成 `AndroidBridge.lsGet/lsSet/lsDel`，避免 WebView 存储不稳导致题库丢失
- 振动：WebView 没有 `navigator.vibrate` 时，用 `AndroidBridge.vibrate` 补一个
- 状态栏/导航栏米黄、深色图标

## 改页面后重新打包

```sh
cd /root/workspace/quiz && node test/build-single.js && cd ../quiz-app && bash build.sh
```

## 注意

- 装的时候要允许「未知来源」；debug 签名，换签名要卸载重装
- APK 里页面不联网，导入的题库存在 App 私有 SharedPreferences
