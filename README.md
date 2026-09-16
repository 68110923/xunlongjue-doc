# docs/ — 文档站源文件（唯一真源）

本目录是 **`xunlongjue-doc` 公开站点的源文件**。
修改请**只改这里**，由 GitHub Actions 自动同步到 `68110923/xunlongjue-doc` 并发布 Pages。

```
xunlongjue-pro/docs/   ← 源（本目录，私有）
        │  Actions: .github/workflows/sync-doc.yml
        ↓
xunlongjue-doc（公开）  ← GitHub Pages 直接托管，请勿手工编辑
```

## 内容

| 文件 | 页面 |
|---|---|
| `index.html` | 宣传页 |
| `legal/terms.html` | 用户协议 |
| `legal/privacy.html` | 隐私政策（含密码加密说明） |
| `legal/risk.html` | 风险揭示书 |

## 两条编写纪律

1. **宣传页不放业绩数字**——不放胜率、收益、月度柱状图（合规要求，见 WEB-PLATFORM-DESIGN.md §5.6）
2. **页脚必须有免责声明**——「仅供研究 · 不构成投资建议」

## 本地预览

```bash
cd docs && python3 -m http.server 8080
```
