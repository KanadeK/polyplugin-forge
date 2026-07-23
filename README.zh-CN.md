# PolyPlugin Forge

PolyPlugin Forge 是一个本地优先的插件开发工具。它使用一份可审计的
`plugin.yaml`，为 MCP、VS
Code、Chrome 和 webhook 目标生成脚手架、原生 manifest、发布前检查与兼容性证据。

项目采用分阶段、可审查的提交开发。领域核心与文件系统、进程和浏览器适配器分离，因此重要规则可以在无网络、无界面的环境中稳定测试。

## 当前范围

- 明确描述能力、权限、数据流、隐私、运行时与兼容约束的统一清单。
- 四种可复现的 hello-world 模板。
- 原生 manifest 生成与 schema 校验。
- 发布前安全和完整性检查。
- 兼容矩阵与不会静默覆盖用户文件的模板升级。

v0.1.0 的公开发布以完整本地验收、GitHub
Actions、制品安装验证和贡献者身份校验为硬门槛。

## 开发

Node.js 22 是受支持的发布运行时。项目使用 pnpm
workspace 管理依赖，同时保留可复现的 `npm ci` 发布门禁。

```bash
npm ci
npm run verify
```

进一步信息见[架构](docs/ARCHITECTURE.md)、
[隐私与安全](docs/PRIVACY_AND_SECURITY.md)和
[相邻项目抽样检索](docs/COMPETITOR_SCAN.md)。

## 许可证

[MIT](LICENSE)
