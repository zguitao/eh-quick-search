# E-Hentai / ExHentai 快速搜索标签

把 EhViewer 导出数据库中的 `QUICK_SEARCH` 标签带到 E-Hentai 和 ExHentai 网页搜索框下方。标签支持中文翻译、自动分类和快速搜索。

## 主要功能

- 导入 EhViewer 导出的 SQLite `.db` 文件，并将新标签合并到现有列表。
- 在网页搜索框下点击标签搜索；支持中键或 Ctrl + 左键在新标签页打开。
- 按语言、女性、男性、角色、艺术家等类别自动分组；可调整分类顺序和默认折叠状态。
- 使用 EhTagTranslation 数据显示中文标签名，并定期检查更新。
- 手动新增、编辑、删除、排序标签，也能把当前搜索框里的词保存为标签。
- 点击“汉语”可在现有搜索词后追加 `language:chinese$` 并搜索。
- 可将标签或当前搜索框中的词用于 WNACG 搜索；作品页还有“WNACG搜同名”入口。
- 导出标签为 SQLite `.db` 文件，方便备份和再次导入。

## 使用方法

安装脚本后，打开或刷新 [E-Hentai](https://e-hentai.org/) 或 [ExHentai](https://exhentai.org/) 页面。在搜索框下方找到“快速搜索”，点击“导入 .db”选择 EhViewer 的数据库。首次打开时标签列表默认折叠，点击左侧箭头展开。

两个站点共用油猴脚本管理器中的标签数据。导入和导出的数据库在浏览器本地处理，不会上传到服务器；翻译数据会从 EhTagTranslation 的发布源下载。

项目源码和完整说明：[GitHub 仓库](https://github.com/zguitao/eh-quick-search)。
