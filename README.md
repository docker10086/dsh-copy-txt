# dsh-copy-txt

把长文本粘贴进 DeepSeek Harness 对话框时，自动变成 `.txt` 附件，而不是撑满输入框。效果接近 ChatGPT 的「粘贴文本 → 文件卡片」。

English summary: when you paste a long plain-text clipboard into the DSH composer, this plugin intercepts the paste and attaches it as `粘贴的文本 (YYYYMMDD-HHmmss).txt` on the draft rail.

## 效果

粘贴一段终端日志、报错栈、配置文件或整页文档时：

- 输入框保持干净，只留下你真正要说的话
- 附件栏出现一张 txt 文件卡片（文件名带时间戳）
- 发送后模型仍能读到完整内容

短文本、图片/文件粘贴不受影响。按住 **Shift** 再粘贴，可以强制把长文本原样放进输入框。

## 何时会转换

默认同时满足「启用」，并且下面 **任一** 条件成立：

| 条件 | 默认值 |
| --- | --- |
| 纯文本字符数 ≥ | 400 |
| 纯文本行数 ≥ | 8 |

不会转换的情况：

- 剪贴板里已经有文件（例如复制的图片、资源管理器里的文件）
- 当前会话不能添加附件（发送中、锁定、子代理限制等）
- 插件已关闭
- Shift + 粘贴（可在设置里关掉这个例外）

## 安装

把本仓库作为本地 DSH 插件包安装到当前 profile。插件面向 DeepSeek Harness 桌面版：Host 负责保存设置，内嵌 Web UI 负责拦截粘贴并显示设置页。目录里已经包含 `package.json`、`cordis.patch.yml`、Host 入口和 Web Client 入口。

### 方式一：链接本地目录

在 profile 的 `package.json` 中加入：

```json
{
  "dependencies": {
    "dsh-copy-txt": "link:D:/DSH/work/dsh-copy-txt"
  },
  "dsh": {
    "profile": {
      "bundles": ["dsh-copy-txt"]
    }
  }
}
```

路径改成你 clone 后的实际位置。安装或启用后重启 DSH。

### 方式二：从 GitHub 安装

```bash
dsh plugin add https://github.com/docker10086/dsh-copy-txt.git
```

或在设置 → 插件里添加该仓库地址。

## 设置

打开 **设置 → 长文本粘贴**：

- **启用**：总开关
- **字符数阈值** / **行数阈值**：任一达到即转换
- **按住 Shift 原样粘贴**：需要把长文本直接贴进输入框时使用

设置会写到：

```
<DSH_HOME>/plugin-data/<profile>/dsh-copy-txt/config.json
```

同时缓存在浏览器 `localStorage`，Host 暂时不可用时仍然生效。

## 工作原理

1. 在捕获阶段监听 `paste`，只处理落在 composer（`[data-composer-input]` / `[data-composer-card]`）上的纯文本。
2. 超过阈值时 `preventDefault` + `stopImmediatePropagation`，阻止 Lexical 把整段文字写进草稿。
3. 用剪贴板文本构造一个 `text/plain` 的 `File`，通过 composer 自带的隐藏 `<input type="file">` 走官方附件通道（和点「添加文件」相同），因此上传、进度、失败重试、发送凭证都复用 DSH 自己的逻辑。

不修改 DSH 源码，也不替换 composer 组件。

## 开发

```
dsh-copy-txt/
  package.json
  cordis.patch.yml
  index.js      # Host：设置读写
  client.js     # Web：粘贴拦截 + 设置页
  README.md
  LICENSE
```

`dsh.client.platform` 使用 `web`：这是桌面版内嵌 Web UI 插件的正确配置。若 profile 开启了客户端 HMR，改 `client.js` 后会随 watcher 更新；Host 改动需要重启。

## 许可

MIT
