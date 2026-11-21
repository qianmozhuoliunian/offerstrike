# OfferStrike 真实业务质量评估

**结论：闭环在合适来源上可用，但当前不能作为稳定的面经发现和自适应备战工具。** 20 组中，19 组有产品保留的搜索线索，5 组有候选，只有 2 组满足本次确认入库标准并走完闭环。四组纠正答卷中，没有一组合理降低原薄弱点的优先级。评估基线为 `18e8b24a9f816c95a541498249dff31aeeea1f5a`。本阶段未修改产品逻辑。 [计分规格](specs/business-quality-evaluation.md)

## 优先问题

1. **从搜索线索到可确认题目的转化太低。** 14/20 组没有发起正文读取。当前自动正文读取只支持博客园特定文章格式，来源平台、链接格式、岗位／文章类型筛选，以及近期任务对结构化日期的要求都会限制入口。实际发起的 7 次读取全部成功，因此优先定位为什么没有尝试读取，并在同一批样本下验证改动。9 组有时间窗口的样本中，0 组产出候选。缺题原因不能用“源站读取失败”概括。 [运行原始记录](evaluations/business-quality-2026-11-17/live-collect.jsonl)
2. **逐字证据仍可能被用于错误的公司或来源类型。** 腾讯约束下返回的一道 React 问题确实在正文里，但位于远景能源小节。服务返回的公司字段为空，仍把它作为满足搜索主题的候选返回。另外 2 组候选来自作者明确标明的读者分享或整理。它们有学习价值，本次按作者自述确认的业务标准拒绝入库。优先把公司段落归属和原帖作者自述作为可解释的核对结果。 [多公司原帖](https://www.cnblogs.com/huansky/p/5973655.html) · [读者分享案例](https://www.cnblogs.com/javaguide/p/17041467.html) · [整理案例](https://www.cnblogs.com/linjingyg/p/15669524.html)
3. **点评的“遗漏”及知识点名称漂移会让 Career 在用户纠正后继续追旧错。** 7 条正确答卷中 3 条被结构化误标遗漏。四条更正答卷之后没有一条达到合理降优先级，主要由原题未要求的扩展被标为遗漏、同一能力改名后未对齐所致。先让遗漏可定位到原题的具体要求，再用现有 Golden Dataset 验证纠正后是否减少旧错误驱动的推荐。 [逐条判定](evaluations/business-quality-2026-11-17/adjudication.json)

## 样本与实际环境

20 组覆盖 AI 应用／Agent、算法、前后端、数据、测试、运维、SRE、C++、Android 和 Go。10 组指定公司，10 组不限。11 组不限时间，另 9 组使用近一年、半年或三个月。每组一次真实 Research 和一次独立的真实 Interview，固定答卷分为 7 正确、6 错误、7 不完整，其中 4 道错误另有真实模型点评纠正答卷。所有答卷及预期依据在调用前编写，均为合成输入。 [20 组 Golden Dataset](../tests/fixtures/business-golden.mjs)

2026-11-17 使用真实 Tavily Basic、官方 `deepseek-flash`、Node v24.14.1 和独立 SQLite。业务采样通过现有产品接口处理函数调用真实上游；各场景使用空的新数据库，Interview 固定题与 Research 题库分离。此次测量没有配置 Exa、FastAPI 检索适配或博客园复核试点。原始输出与预先冻结的判定标准逐项对照，Codex 执行复核，尚无独立人工复标和评审者一致性结果。 [逐条判断和参考答案](evaluations/business-quality-2026-11-17/adjudication.json)

## Research

| 指标 | 结果 | 口径 |
| --- | ---: | --- |
| 搜索供应商有命中 | 20/20 | 任何一次 Tavily 响应有原始结果 |
| 产品有保留线索 | 19/20 | 共 320 条场景内去重线索，相关性未逐篇验证 |
| 产品尝试读取正文 | 6/20 | 7 次正文读取请求 |
| 正文读取成功率 | 7/7 | 只用实际读取调用作分母 |
| 产出候选 | 5/20 | 共 12 条，涉及 5 篇原帖 |
| 原文摘录可定位 | 12/12 | 独立重新读取公开原帖验证 |
| 主题相关 | 12/12 | 与输入的宽主题相关，未要求等于 Interview 固定题的细粒度考点 |
| 指定公司候选实际符合 | 3/4 | 只有两个指定公司场景产出候选。另 1 条属远景能源，而查询公司是腾讯 |
| 公司字段准确率 | 无分母 | 4 条指定公司候选均未声明公司。其原帖实际归属能人工复核 |
| 严格可确认入库 | 2/20 场景 | 共 5 道题，要求作者自述、原文吻合且符合查询范围 |

13 组停在轮次上限，1 组没有通过产品筛选的线索，1 组耗尽读取次数仍无候选，5 组在服务内部达到主题覆盖。18 组未通过严格闭环的主要原因是 15 组未产出候选、2 组来源为读者分享或整理、1 组公司范围错误。真实上游本轮 36 次搜索均返回 HTTP 200。 [真实结果](evaluations/business-quality-2026-11-17/live-collect.jsonl) · [独立正文定位记录](evaluations/business-quality-2026-11-17/live-anchors.jsonl)

## Interview 与 Career

| 检查 | 结果 |
| --- | ---: |
| 自然语言技术点评通过 | 19/20 |
| 符合 Schema 的结构化评价 | 20/20 |
| 结构化区分正确回答 | 4/7 |
| 结构化识别错误回答 | 6/6 |
| 结构化识别不完整回答 | 7/7 |
| 返回的回答引用可逐字核对 | 65/65 |
| 已提出的追问针对实际薄弱点 | 11/12 |
| 错误或不完整答卷没有追问 | 2/13 |
| 空库下触发相应补题任务 | 20/20 |
| 纠正后合理降低旧薄弱点优先级 | 0/4 |

第 03 组自然语言认可了缩放的核心逻辑，但补充解释遗漏了推出点积方差恰为维度所需的单位方差前提。第 14、17 组也给出大体正确的自然语言，却分别将题干未要求的故障定位、析构行为写成遗漏。逐字校验只验证摘录来自回答，无法冻结模型对题意的解释。 [原始评价](evaluations/business-quality-2026-11-17/live-collect.jsonl) · [Transformer 原论文](https://arxiv.org/abs/1706.03762)

| 更正样本 | 首选动作变化 | 是否符合预期 |
| --- | --- | --- |
| 01 RAG | 追问 → 复习 | 否。仍保留旧错，还把选择 k 当成原题遗漏 |
| 04 HTTP 会话 | 追问 → 复习 | 否。新评价没有弱点，但同义知识点改名后仍使用旧历史 |
| 07 React key | 复习 → 追问 | 否。已说明头部插入造成错配，模型仍判缺少该场景 |
| 10 HTTP 缓存 | 追问 → 追问 | 否。已纠正两个指令语义，系统改追原题未要求的验证失败处理 |

## 端到端、耗时与计费

- **按全部样本**为 2/20。**按已核对、可确认并提交的样本**为 2/2。第 04 组由一面 HTTP 原题、实题回答到按同一作答追问会话机制。第 08 组由百度前端实习面经中的 JavaScript 数据类型题到原题复习。两条任务均进入完成状态，新的 Career 依据都指向本次作答 ID。确认阶段重新打开第一阶段保存的数据库，未重复检索。 [HTTP 原帖](https://www.cnblogs.com/jianrenfang/p/8697397.html) · [JavaScript 原帖](https://www.cnblogs.com/WindrunnerMax/p/13986608.html) · [两条闭环结果](evaluations/business-quality-2026-11-17/live-e2e.jsonl)
- 另用真实 HTTP 服务交叉验证 HTTP 缓存题。Tavily 搜索和 DeepSeek 提取耗时 7.67 秒，服务重启后恢复候选，点评耗时 2.42 秒，Career 从补题转为针对缓存指令的追问。这条额外调用单独消耗 1 次 Tavily Basic、1 次 DeepSeek 提取和 1 次 DeepSeek 点评，未计入 20 组成绩及费用。 [HTTP 重启记录](evaluations/business-quality-2026-11-17/http-cross-check.jsonl)
- Research 20 组 P50 **4.21 秒**、P90 **11.38 秒**、最大 **15.57 秒**。Interview 首次点评 20 组 P50 **2.11 秒**、P90 **2.55 秒**。两条闭环合计的服务处理耗时分别为 **4.44 秒**和 **4.89 秒**，由检索、确认、点评和读回的计时组成，排除人工核对间隔。
- 20 组及两条完成确认的样本共 **36 次** Tavily Basic，按公开计费规则估算 **36 credits / USD 0.288**。Tavily 响应未返回独立账单字段。DeepSeek **33 次**均返回用量，共 **12,416** 命中缓存输入 token、**23,640** 未命中输入 token、**8,652** 输出 token，按峰时公开价估算 **USD 0.01755**，其中 Research 提取约 USD 0.00613、固定答卷及更正约 USD 0.01070、两条入库题点评约 USD 0.00072。合计公开价估算 **USD 0.30555**，未取得实付账单，免费额度与套餐会影响实付。 [Tavily 计费](https://docs.tavily.com/documentation/api-credits) · [DeepSeek 定价](https://api-docs.deepseek.com/quick_start/pricing/)

## 与 InterviewRadar 的公开实现对照

通过公开 HEAD 和固定提交源码核对 InterviewRadar `f551c9c24e274c4a361e870f5e269ddb7cef6ca6`。对照未运行同一批样本，表中实现差异不能作为实测质量排名。 [上游提交](https://github.com/KunChen1110/InterviewRadar/commit/f551c9c24e274c4a361e870f5e269ddb7cef6ca6)

| 维度 | InterviewRadar 的公开实现 | OfferStrike 的证据 |
| --- | --- | --- |
| 发现与读取 | 由宿主 WebSearch 发现，牛客 connector 从已有 URL 读取正文及页面内时间字段。GitHub 与通用网页为补充，小红书依赖可选 MediaCrawler／OCR | 本次 Tavily 20/20 有命中，自动正文只覆盖 6 组。InterviewRadar 的当前站点可用率、登录成本和相同岗位覆盖率未实测 |
| 证据、去重与时效 | 提取候选与模型决策以 ID 关联，复核归一化引用及日期。归并后按独立来源数乘时效权重排序，频次用于同分排序，无日期可降权保留 | 本次 12/12 摘录可定位，仍出现公司和来源类型问题。现有强项是核对后入库并保留题目身份。跨源频次和近期覆盖尚未证明优于上游 |
| 备战体验 | 公开流程把简历项目、证据和高频题接成 Markdown 备考包及项目追问链 | 真实验证了应用内审核、入库、按作答追问／复练及持久化。已有能力历史容易复查，但更正后的推荐可靠性 0/4。简历项目锚定和两产品实际学习收益均未对照 |

源码依据分布在 [工作流](https://github.com/KunChen1110/InterviewRadar/blob/f551c9c24e274c4a361e870f5e269ddb7cef6ca6/SKILL.md)、[牛客 connector](https://github.com/KunChen1110/InterviewRadar/blob/f551c9c24e274c4a361e870f5e269ddb7cef6ca6/scripts/connectors/nowcoder.py)、[候选提取](https://github.com/KunChen1110/InterviewRadar/blob/f551c9c24e274c4a361e870f5e269ddb7cef6ca6/scripts/corpus/extraction.py)、[质量核验](https://github.com/KunChen1110/InterviewRadar/blob/f551c9c24e274c4a361e870f5e269ddb7cef6ca6/scripts/corpus/quality.py)和[去重与排序](https://github.com/KunChen1110/InterviewRadar/blob/f551c9c24e274c4a361e870f5e269ddb7cef6ca6/scripts/corpus/dedupe_rank.py)。

## 复现与独立回归

先用固定输入复算本次历史结果，或在新目录重采。新一轮用新的候选 ID，在核对原文后按 [确认格式](evaluations/business-quality-2026-11-17/confirmed.json) 生成本轮清单。索引、站点和模型变化会改变结果。正式发布前，复查全部公司候选、误标遗漏和纠正后仍复习的案例，记录独立人工复标结果。

```powershell
node scripts/business-eval.mjs
node scripts/business-eval-summary.mjs
New-Item -ItemType Directory -Force data/business-quality
node --env-file=.env scripts/business-eval.mjs --live --state=data/business-quality/replay |
  Set-Content -Encoding UTF8 data/business-quality/replay-collect.jsonl
node scripts/business-eval.mjs --phase=anchors --input=data/business-quality/replay-collect.jsonl |
  Set-Content -Encoding UTF8 data/business-quality/replay-anchors.jsonl
node --env-file=.env scripts/business-eval.mjs --live --phase=confirm --state=data/business-quality/replay --reviewed=data/business-quality/reviewed.json |
  Set-Content -Encoding UTF8 data/business-quality/replay-e2e.jsonl
node --env-file=.env scripts/career-eval.mjs --live --coordinated
```

**Mock 与集成回归**独立执行，156 项 Node、22 项 FastAPI 通过。它们提供故障、证据格式、人工确认、状态和存储的流程证据。上面的覆盖、点评质量、建议和公开价估算来自真实上游，分母始终为明确标注的样本。
