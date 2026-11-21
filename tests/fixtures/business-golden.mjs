// Authored test prompts and answer keys, not obtained from applicants or model outputs.
export const scenarios = [
  ['01','AI 应用开发实习生','字节跳动','RAG','all','year','wrong','怎么评估 RAG 的检索质量？','RAG 只要检索到更多文档，答案就一定更准确。','召回更多可能引入噪声。用有相关性标注的集合测 Recall@k、Precision@k 或 nDCG，和生成质量分开。','如何测量检索质量或分离检索与生成？','用有相关性标注的测试集计算 Recall@k 和 Precision@k，再单独评估生成答案，不假定召回越多越准确。'],
  ['02','AI Agent 开发实习生','','工具调用','cnblogs','all','incomplete','Agent 调用外部工具失败时，如何处理超时和有副作用的重试？','对工具调用设置超时，超时后告诉用户。','超时处理合理，缺少避免重复副作用的幂等键、查询状态或仅对可重试错误有限重试。','超时但实际已经执行时，如何避免重复扣款或写入？'],
  ['03','算法工程师','阿里巴巴','注意力','nowcoder','6m','correct','Transformer 为什么将 QK 的点积除以根号 d_k？','维度增大时，未缩放点积的方差会增大，softmax 容易饱和。除以根号 d_k 可以稳定尺度。','点积尺度随维度增长，缩放可降低 softmax 饱和风险。无需断言所有分布严格同方差。','可不追问，或问大点积如何影响 softmax 梯度。'],
  ['04','后端开发','今日头条','HTTP','cnblogs','all','wrong','说说 HTTP 的无状态和会话。','HTTP 本身会自动保存每个客户端的登录会话，所以服务端不需要 Cookie 或令牌。','HTTP 协议无状态，会话由应用层通过 Cookie/Session/Token 等实现。','服务端如何识别同一用户的连续请求？','HTTP 本身不保留请求间的登录状态。应用可用 Cookie 传会话 ID，在服务器查询状态，也可以验证客户端提交的令牌。'],
  ['05','Java 后端开发','美团','Redis','all','year','incomplete','缓存穿透和缓存击穿的区别是什么？分别如何缓解？','缓存穿透是查询根本不存在的数据，可以用布隆过滤器，或者给查询不到的数据设置短期空值缓存。','穿透和缓解合理，漏答热点键失效造成的击穿以及单飞、互斥重建等缓解。','热点键到期时怎样防止大量请求同时打主库？'],
  ['06','后端开发','','MySQL','cnblogs','all','correct','MySQL InnoDB 的覆盖索引是什么？举一个例子。','如果查询所需列已包含在索引里，就可从索引取数而不回表。例如对 (a,b) 建联合索引，SELECT b FROM t WHERE a=1。','覆盖是针对查询。示例的过滤与返回列均在索引。','可不追问，或改变 SELECT 列核验何时需要回表。'],
  ['07','前端开发','腾讯','React','cnblogs','all','wrong','React 列表中使用数组索引作为 key 有什么问题？','数组索引永远都可以当 key，列表插入删除时 React 会自动把旧组件状态移动到对应的数据项。','重排时索引不能代表稳定数据身份，组件状态可能错位。稳定业务 ID 更合适。','头部插入元素后本地输入状态绑定到哪一项？','列表可能重排时要用稳定业务 ID；索引恰好对应位置，头部插入会让 React 把旧组件状态复用到别的数据项。'],
  ['08','前端开发实习生','','JavaScript','cnblogs','all','correct','浏览器事件循环中，同一段同步代码后，已排队的 Promise.then 和 setTimeout(0) 谁先执行？','先执行完同步代码，再清空微任务队列，所以这时 Promise.then 先于作为任务排队的 setTimeout 回调。','在给定浏览器与已排队前提下顺序正确。','可不追问，或给一段短代码核验宏任务与微任务。'],
  ['09','前端开发实习生','字节跳动','Vue','juejin','6m','incomplete','Vue 的 computed 与 watch 分别适合什么场景？','computed 适合通过已有状态派生一个值，会按响应式依赖缓存。','computed 回答正确，漏掉 watch 监听变化执行副作用，例如请求或持久化。','用户名改变时要触发接口请求，为什么选择 watch？'],
  ['10','Web 前端开发','','浏览器缓存','all','all','wrong','HTTP 缓存中 Cache-Control: no-cache 与 no-store 有什么区别？','no-cache 表示完全不允许存储响应；no-store 则可以存，但每次要先向服务器验证。','两种含义颠倒。no-cache 可以存但复用前需验证，no-store 不应存储。','条件请求重新验证时 ETag 和 304 如何使用？','no-cache 允许存储，复用前需成功重新验证；no-store 要求缓存不要存储请求或响应。'],
  ['11','数据开发','快手','Flink','nowcoder','year','incomplete','Flink 的 checkpoint 在解决什么问题？外部 sink 如何保证端到端 exactly-once？','checkpoint 会记录算子状态和消费位置，失败后可以从快照恢复。','内部恢复合理，漏掉 sink 事务／幂等与源可重放。不可把 checkpoint 单独视为端到端保证。','如果 sink 已写出但 checkpoint 未提交，怎么避免恢复后重复？'],
  ['12','数据分析师','','SQL','all','year','correct','SQL LEFT JOIN 后，在 WHERE 对右表列取等值会怎样影响未匹配行？','未匹配的右表列是 NULL，WHERE 右表列等于常量得到 UNKNOWN，行会被过滤；把条件放 ON 中可保留左表未匹配行。','正确说明三值逻辑，条件移到 ON 不等价且可保留左表。','可不追问，或比较 ON 与 WHERE 下的样例输出。'],
  ['13','测试开发','字节跳动','接口测试','cnblogs','all','incomplete','设计创建订单接口的测试，要覆盖成功、校验失败和重试。','我会覆盖正常创建和缺少商品 ID 的参数校验。','两类覆盖合理，明确漏答重试、幂等键、重复创建或结果复用。','超时后用相同幂等键重试时应断言什么？'],
  ['14','测试开发','','并发测试','all','3m','correct','如何验证最后一件库存不会在并发购买时被超卖？','让多个独立请求用同步屏障同时发出，检查成功数不超过库存，最终库存非负，并核对订单、扣减记录与返回结果一致。','有并发触发、状态和持久化一致性断言，适合给定问题。','可不追问，或问失败重试和重复请求怎样测。'],
  ['15','运维开发','','Kubernetes','cnblogs','all','wrong','Kubernetes readiness probe 失败时，通常会发生什么？与 liveness 有什么区别？','readiness 失败会重启容器，liveness 失败只会把 Pod 从 Service 后端摘掉。','行为说反。readiness 去流量，liveness 失败可重启容器。','依赖暂时不可用应选哪个探针，为什么？'],
  ['16','SRE','腾讯','Linux','all','6m','incomplete','Linux load average 升高但 CPU 利用率不高，可能是什么原因？如何定位？','我会先用 top 看进程和 CPU 利用率。','定位起点合理，未解释可运行任务或不可中断睡眠，需结合 D 状态、I/O 指标定位。','哪些进程状态或 iostat 指标能确认 I/O 等待？'],
  ['17','C++ 开发','','线程','cnblogs','all','correct','C++ 中 join 和 detach 的区别是什么？','join 等到线程结束再返回；detach 让它独立运行。detach 后必须管理共享对象的生命周期，不能再通过原对象 join。','行为及生命周期风险正确。','可不追问，或问 detached 线程捕获局部变量引用的风险。'],
  ['18','Android 开发','小米','ANR','nowcoder','year','wrong','Android 出现 ANR 是否只能因为主线程死锁？','只能是主线程发生死锁。只要没有死锁，即使主线程长时间同步做磁盘 I/O 也不会触发。','死锁只是可能原因；长耗时 I/O 等阻塞主线程，可能因事件/组件超时而 ANR。','如何用 trace 区分主线程在等锁还是执行 I/O？'],
  ['19','机器学习工程师','','数据泄漏','all','all','incomplete','怎样避免标准化步骤把验证集信息泄漏给模型？交叉验证中怎么做？','先划出测试集，训练时不要读取测试样本。','划分正确但未说明 scaler 仅在训练折 fit，验证折只 transform。','在每折的训练和验证阶段分别对 scaler 做什么？'],
  ['20','Go 后端开发','','context','cnblogs','all','correct','Go 的 context 取消信号能强制终止 goroutine 吗？','不能。取消会关闭 Done 通道，goroutine 或阻塞调用要主动监听或接收 context，并在取消后返回。','协作式取消正确，不能把 cancel 当作强制杀线程。','可不追问，或问不接收 context 的阻塞 I/O 如何处理。']
].map(([id,role,company,topic,source,range,label,question,answer,criteria,followup,improved]) =>
  ({id,role,company,topic,source,range,label,question,answer,criteria,followup,...(improved ? {improved} : {})}));
