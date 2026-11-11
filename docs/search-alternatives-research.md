# 面经搜索：Tavily 替代方案调研

调研日期：2026-11-11。目标是在保留原帖链接、时间范围和来源核验能力的前提下，降低搜索 API 成本。以下是文档调研，尚未对牛客、掘金、知乎的召回率和可访问性进行实测，不能据此断定哪家效果最好。

## 建议

优先做一次小规模对比：将**自建 SearXNG**作为无需搜索 API 密钥的候选，将 **Brave Search API** 作为低成本托管候选，保留现有 Tavily 作基线。先用相同岗位、公司、平台和时间范围评估结果，再决定是否接入；没有依据声称免费方案一定满足产品需求。

当前项目的 `/api/search` 只调用 Tavily；结果经域名和日期过滤，日期未知的结果在限定时间范围下被隐藏，搜索摘要并不等于用户确认的题目。产品要求保留来源链接、标记未知日期，并且用户设定的时间范围不能自动突破。见项目 `server.js`、`README.md` 和 `DESIGN.md`。

## 方案与限制

| 方案 | 成本与可用性 | 对本项目的主要限制 |
| --- | --- | --- |
| 自建 SearXNG | 开源元搜索服务，聚合其他搜索引擎；不需要 Tavily 密钥或搜索 API 订阅，但要部署、维护并承担机器和网络成本。[项目说明](https://github.com/searxng/searxng/blob/master/searx/infopage/en/about.md)、[容器安装](https://docs.searxng.org/admin/installation-docker.html) | 它不是自己的网页索引；结果依赖上游引擎、网络和平台收录。上游可能出现验证码、限流或封禁。自建也不保证能搜索登录后内容。[引擎说明](https://github.com/searxng/searxng/blob/master/docs/dev/engines/engine_overview.rst)、[实例风险](https://github.com/searxng/searxng/blob/master/docs/own-instance.rst) |
| 公共 SearXNG 实例 | 可用于人工初步试验，无需自己部署；是否允许程序访问须查看具体实例设置和规则。 | 很多实例关闭 JSON，未启用时请求返回 403；还要信任实例运营者处理查询，不能假设其稳定或适合承载个人岗位信息。[搜索 API](https://docs.searxng.org/dev/search_api.html)、[实例风险](https://github.com/searxng/searxng/blob/master/docs/own-instance.rst) |
| Brave Search API | 官方说明每个计划每月有 5 美元免费额度，Search 计划按其示例约相当于 1,000 次查询；没有独立免费计划，即使预付金额为 0，注册仍需信用卡验证。实际价格和政策以开通时页面为准。[官方问答](https://api-dashboard.search.brave.com/documentation/resources/help-feedback) | 需要密钥和外部服务，超出免费额度会产生费用；中文平台覆盖与时间准确度仍需实测。它支持预设及自定义日期范围，但结果日期仍须回原帖核对。[Web Search 文档](https://api-dashboard.search.brave.com/documentation/services/web-search) |
| Google Custom Search JSON API | 对已有客户，官方列出每日 100 次免费查询。 | 官方已关闭新客户注册；现有客户需在 2027-01-01 前迁移，因此不建议作为新接入方案。[官方说明](https://developers.google.com/custom-search/v1/overview) |

SearXNG 的 HTTP 搜索接口支持 `q`、`format=json`；自建时需要在 `settings.yml` 显式启用 JSON。其 `time_range` 仅列出 day、month、year，且取决于上游支持；`site:` 等语法也未必被每个上游执行。因此不能直接把现有三个月、半年及自定义日期筛选视为已得到服务端精确支持，仍须针对返回日期严格过滤并标明未知。[搜索 API](https://docs.searxng.org/dev/search_api.html)、[默认配置](https://github.com/searxng/searxng/blob/master/searx/settings.yml)

开源参考：[Hermes Agent 的 SearXNG 搜索技能](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/skills/optional/research/research-searxng-search.md)描述通过配置实例地址使用 SearXNG，并在主要搜索服务未配置时作为备用。这是通用搜索集成实例，不是中文面经覆盖率的证据。搜索请求会从 SearXNG 发往外部搜索服务，自建不意味着搜索词只留在本机。[SearXNG 搜索 API](https://docs.searxng.org/dev/search_api.html)

## 实验与接入边界

1. 固定一组不同岗位、公司和三个现有来源的查询，包含近三个月、近半年、近一年及不限时间；分别记录请求次数、延迟、失败率、费用和域名分布。对各方案使用相同查询，保留原始返回结果供人工复核。
2. 人工检查结果是否能打开、是否为相关岗位的作者自述面经、是否重复、原帖日期能否核实，以及搜索日期与原帖日期是否一致。比较每次查询可用来源数量；搜索摘要和日期均不能直接当成已验证事实。
3. 若接入，使用统一的搜索服务接口，保留标题、原始链接、摘要、提供方、日期及日期依据；将无日期结果明确标为未知，严格遵守用户的时间选择。搜索失败、部分上游失败和零结果应有可见提示；零结果不等于不存在面经。
4. 限制查询只包含完成搜索所需的信息，向用户说明查询发往哪一家服务；不要把简历或其他不必要的个人数据发送给公共实例。继续支持手动添加来源和用户确认题目。

本调研没有部署实例、调用搜索 API 或验证各平台服务条款；上线前需另行验证数据获取方式及实际运行成本。
