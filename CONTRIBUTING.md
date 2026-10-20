# 贡献

先安装 Node.js 22.13+，运行 `npm ci`、`npm run build`、`npm test` 与 `npm run test:ui`。没有本机 Chrome 时运行 `npx playwright install chromium`。测试采用独立临时目录与合成数据。

修改请围绕一个可复现问题，说明触发步骤、预期、实际行为与验证结果。GIS 精度修改请提供公开或合成控制点、坐标系及误差依据；不要上传私人作业数据。

提交前检查 `git diff --cached`：排除 `.env`、真实 GeoJSON、地图包、SQLite、日志、浏览器配置及本机路径。保留所有第三方版权和图源署名。

报告安全问题时使用仓库的私密漏洞报告入口（如果已启用），或先以不含敏感细节的 Issue 联系维护者。不要公开贴凭据。
