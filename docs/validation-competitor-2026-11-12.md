# 面试助手的竞品能力核对

核对日期：2026-11-12。目的是检验“找到目标岗位相关的真实面经，并依据作答持续复习”是否仍有实际价值，不以功能数量或项目热度替代用户收益。

本次只阅读第一方 GitHub README、工作流和相关源码，未安装或运行竞品，未实测抓取成功率、题目质量、模型效果、复习收益或付费意愿。源码证明存在实现路径，不证明线上效果；下文“未确认”不等于竞品没有。截图未确认作者，因此仍不能断言用户所指项目就是以下任何一个。

## 对象与版本

- JavaGuide 作者的第一方 [GitHub 个人页](https://github.com/Snailclimb) 指向 **[Snailclimb/interview-guide](https://github.com/Snailclimb/interview-guide)**；`JavaGuide/interview-guide` 在本次 GitHub API 读取中返回 404。本文主比较对象固定于 [`ebe2697`](https://github.com/Snailclimb/interview-guide/tree/ebe2697aeaa1c35fc780238f626165cf3e807782)。
- **[INYerty/interview-guide](https://github.com/INYerty/interview-guide/tree/cbd835e3b02f1a6f14a66f246bbd3c55d05dab05)** 是另一个确实存在的仓库。本次快照 `cbd835e`；不能仅凭相同名称认定它就是截图项目，也不能用其较旧说明代替 Snailclimb 当前实现。
- **[InterviewRadar](https://github.com/KunChen1110/InterviewRadar/tree/f551c9c24e274c4a361e870f5e269ddb7cef6ca6)** 固定于 `f551c9c`，作为“真实来源发现、原文证据与个性化备考”的直接参照。

## 能力证据

| 要解决的问题 | Snailclimb / InterviewGuide | InterviewRadar | 本项目需要证明什么 |
| --- | --- | --- | --- |
| 找到目标岗位的公开面经 | 已核对的出题路径使用方向、简历、JD、历史题目或用户上传知识库；本次未确认公开面经搜索链路 | 工作流明确先由宿主搜索发现 URL，再交给对应连接器读取 | 真实岗位样本里，用户能更快得到可访问、相关的原帖，而非仅搜索接口成功 |
| 题目能回查依据 | 知识库题目保存知识库关联、内容哈希和生成上下文；不能说其没有来源上下文 | 有来源 URL、原文片段、时效过滤与片段存在性校验的代码 | 精确展示原题证据、区分作者自述/整理/AI 生成，并减少人工核查时间 |
| AI 出题与评价 | 文字/语音模拟面试、知识库题库、追问和评价已有相应实现或 README 描述 | 以简历关联的 Markdown 备考包、回答框架和追问链为主要工作流 | 单有 AI 题目、追问或打分不足以形成差异 |
| 根据回答跨天安排复习 | 已确认保存作答、生成报告、历史题去重；抽查的知识库选题是符合筛选条件后随机抽取，文字提交答案后按既有题单前进 | 已读工作流主要输出备考包，本次未确认作答历史驱动的日程调度 | 答错、求助、跳过、自评后，下一次练什么及原因确实改变，而且有帮助 |

### InterviewGuide：已有能力比“通用 AI 面试官”更完整

主仓库 [README](https://github.com/Snailclimb/interview-guide/blob/ebe2697aeaa1c35fc780238f626165cf3e807782/README.md) 已列出知识库生成题目、参考答案、评分标准、题库维护、草稿/启用/归档、作答记录、趋势与报告。它同时支持不上传简历的通用面试，不能把“无需简历”当作本项目独有优势。

源码核对如下：

- [InterviewQuestionService](https://github.com/Snailclimb/interview-guide/blob/ebe2697aeaa1c35fc780238f626165cf3e807782/app/src/main/java/interview/guide/modules/interview/service/InterviewQuestionService.java#L121)：根据方向与可选简历生成主问题及追问；将历史题目摘要加入避免重复的上下文。追问列表在出题阶段生成，这条文字路径不能直接当成“根据刚才回答实时生成追问”。
- [KnowledgeBaseQuestionGenerationService](https://github.com/Snailclimb/interview-guide/blob/ebe2697aeaa1c35fc780238f626165cf3e807782/app/src/main/java/interview/guide/modules/knowledgebase/service/KnowledgeBaseQuestionGenerationService.java)：检索知识库片段、生成结构化题目、以草稿保存，并写入 `sourceContext`、`kbContentHash`；对应 [题目实体](https://github.com/Snailclimb/interview-guide/blob/ebe2697aeaa1c35fc780238f626165cf3e807782/app/src/main/java/interview/guide/modules/knowledgebase/model/KnowledgeBaseQuestionEntity.java) 确有这些字段。这里保存的是生成使用的上下文，不能直接等同于逐题原帖原句经过验证。
- [KnowledgeBaseInterviewService](https://github.com/Snailclimb/interview-guide/blob/ebe2697aeaa1c35fc780238f626165cf3e807782/app/src/main/java/interview/guide/modules/knowledgebase/service/KnowledgeBaseInterviewService.java#L57)：按知识库、方向、难度、追问容量选候选题，再 `Collections.shuffle` 抽取；追问从已有池中抽取。这一方法没有读取用户上次得分来安排复习。
- [InterviewSessionService.submitAnswer](https://github.com/Snailclimb/interview-guide/blob/ebe2697aeaa1c35fc780238f626165cf3e807782/app/src/main/java/interview/guide/modules/interview/service/InterviewSessionService.java#L407)：保存用户答案后取 `index + 1` 的既有下一题，完成后送异步评估。它证明作答记录和评估链路存在；不能据此证明跨天复习调度。此结论只限已读的文字/知识库路径，不推及未完整审查的语音逻辑。

其 README 的“面试安排”指公司面试邀请、日历和提醒；[日程实体](https://github.com/Snailclimb/interview-guide/blob/ebe2697aeaa1c35fc780238f626165cf3e807782/app/src/main/java/interview/guide/modules/interviewschedule/model/InterviewScheduleEntity.java) 记录公司、职位、时间等。应与依据掌握程度决定下一次复习时间分开比较。

INYerty 的 [README](https://github.com/INYerty/interview-guide/blob/cbd835e3b02f1a6f14a66f246bbd3c55d05dab05/README.md) 同样描述简历、模拟面试、语音和 RAG，但把打通模拟面试与知识库列为待办；其 [出题服务](https://github.com/INYerty/interview-guide/blob/cbd835e3b02f1a6f14a66f246bbd3c55d05dab05/app/src/main/java/interview/guide/modules/interview/service/InterviewQuestionService.java) 已有方向/简历出题、追问与历史题上下文。这一快照的待办不能用于评价 Snailclimb 最新版。

### InterviewRadar：来源与证据不是空白市场

- [SKILL.md](https://github.com/KunChen1110/InterviewRadar/blob/f551c9c24e274c4a361e870f5e269ddb7cef6ca6/SKILL.md#L45) 明确由宿主 WebSearch 或同类工具发现链接；[NowCoderConnector](https://github.com/KunChen1110/InterviewRadar/blob/f551c9c24e274c4a361e870f5e269ddb7cef6ca6/scripts/connectors/nowcoder.py) 接收 `post_urls`，读取 HTML 和日期，部分失败保留成功结果并标记降级。连接器方法虽叫 `search()`，实际不独立进行关键词发现。
- [extraction.py](https://github.com/KunChen1110/InterviewRadar/blob/f551c9c24e274c4a361e870f5e269ddb7cef6ca6/scripts/corpus/extraction.py) 从原文切出候选，再以候选构造题面和证据；[quality.py](https://github.com/KunChen1110/InterviewRadar/blob/f551c9c24e274c4a361e870f5e269ddb7cef6ca6/scripts/corpus/quality.py) 默认要求证据，检查来源、时效与规范化原文中的片段匹配，拒绝无法匹配的题目。
- 这种校验能排除部分无依据内容，但片段出现在网页中，不足以证明作者确实参加了面试、题目抽取语义正确或搜索覆盖充分。代码中也有明确的抓取降级状态，不能将 README 覆盖宣称当作成功率。
- 已读 [工作流](https://github.com/KunChen1110/InterviewRadar/blob/f551c9c24e274c4a361e870f5e269ddb7cef6ca6/SKILL.md) 的主要交付是备考包；本次没有验证持续作答、跨天自适应复习产品。不能仅因当前检查未覆盖就断言其绝无相应扩展。

## 对验证的影响

**目前可以支持“存在一个值得验证的窄切口”，不能支持“本项目已经比成熟竞品有价值”。** 模拟面试、知识库、AI 反馈、来源可追溯都有强参照；复刻这些功能不能自动赢得用户。较具体的候选价值是：用户确定近期目标岗位后，从少量可核对原帖快速建立自己的题目集，完成一次练习，次日能依据实际回答或明确自评继续复习。

建议把竞品对照落到同一目标与同一材料：记录找到首批可用原帖和确认题目所需时间、每题原文证据可回查比例、用户纠正的错误，以及连续数天打开产品后能否直接开始有理由的复习。没有真实外部结果或真实模型时，只能验证本地流程及失败提示，不能宣称检索质量、反馈有效性或复习收益已获证实。

先检验现有实现是否闭合这一小段用户流程，再决定继续做独立产品、缩成来源整理/复习工具，还是复用成熟面试平台。以上是验证建议，尚非新增功能承诺。
