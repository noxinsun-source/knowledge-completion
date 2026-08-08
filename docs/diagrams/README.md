# 图表资产维护

本目录保存 README 和架构文档使用的可审计图表资产。

## 文件

| 文件 | 作用 |
| --- | --- |
| `01-system-architecture.mmd` | “产品思路—产品能力—技术原理”映射图源 |
| `01-system-architecture.png` | GitHub README 使用的高清渲染结果 |

`.mmd` 是事实来源；PNG 是发布产物。修改图表时必须同时更新两者。

## 渲染

需要 Node.js、Mermaid CLI 和 Chromium/Google Chrome：

```bash
PUPPETEER_EXECUTABLE_PATH="/path/to/chrome" \
npx --yes @mermaid-js/mermaid-cli@11.12.0 \
  -i docs/diagrams/01-system-architecture.mmd \
  -o docs/diagrams/01-system-architecture.png \
  -w 2400 \
  -H 1800 \
  -s 2 \
  -b transparent
```

macOS 的常见 Chrome 路径：

```text
/Applications/Google Chrome.app/Contents/MacOS/Google Chrome
```

渲染后检查：

1. 左列为产品思路，中列为产品能力，右列为技术原理；
2. 三列都从上到下排列；
3. 主箭头表达“技术实现能力、能力支撑产品”；
4. 中文、公式和连线标签可读；
5. PNG 不是极宽横条，不存在裁切或空白画布。
