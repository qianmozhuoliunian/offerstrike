const originalFetch = globalThis.fetch;
const { appendFileSync } = await import('node:fs');
const { join } = await import('node:path');
globalThis.fetch = async (url, options) => {
  if (String(url)==='https://mock-role.test/v1/chat/completions') {
    const request=JSON.parse(options.body);
    const role=JSON.parse(request.messages.at(-1).content).role;
    const status=role==='科比' ? 'invalid' : role==='AI' ? 'uncertain' : 'valid';
    return Response.json({choices:[{message:{content:JSON.stringify({status})}}]});
  }
  if (String(url)==='https://mock-search-ai.test/v1/chat/completions') {
    const request=JSON.parse(options.body);
    const system=request.messages[0].content;
    if (system.includes('判断输入能否表示求职者')) return Response.json({choices:[{message:{content:JSON.stringify({status:'valid'})}}]});
    const input=JSON.parse(request.messages.at(-1).content);
    appendFileSync(join(process.cwd(),'search-ai-requests.jsonl'),JSON.stringify(input)+'\n');
    if (input.company==='AI失败') return new Response('',{status:503});
    const items=input.candidates.map(candidate=>candidate.title.includes('面经') ? {index:candidate.index,status:'related',role_evidence:'产品',interview_evidence:'面经'} : {index:candidate.index,status:'uncertain'});
    return Response.json({choices:[{message:{content:JSON.stringify({items})}}]});
  }
  if (String(url) !== 'https://api.tavily.com/search') return originalFetch(url, options);
  const request=JSON.parse(options.body);
  appendFileSync(join(process.cwd(),'search-provider-requests.jsonl'),JSON.stringify(request)+'\n');
  const query = request.query;
  if (query.includes('部分失败公司') && query.includes('面试经验')) return new Response('',{status:503});
  const today = new Date().toISOString().slice(0, 10);
  const results = query.startsWith('科比') ? [
    {title:'长鑫科技 AI面试，求经验分享', url:'https://www.nowcoder.com/discuss/1', content:'硬件芯片岗位面试。', published_date:today},
    {title:'如何评价库里签约李宁？', url:'https://www.zhihu.com/question/2', content:'库里与李宁达成合作。', published_date:today},
    {title:'产品实习面经', url:'https://www.nowcoder.com/discuss/3', content:'面试时聊到科比的故事。', published_date:today}
  ] : [
    {title:'产品实习面经', url:'https://www.nowcoder.com/discuss/4', content:query.includes('范围验证') ? query : '一轮面试。', published_date:today},
    {title:'产品经理职业发展建议', url:'https://www.zhihu.com/question/5', content:'岗位介绍。', published_date:today},
    {title:'产品经理面经', url:'https://www.nowcoder.com/discuss/6', content:'面试经历。', published_date:'2020-01-01'},
    {title:'产品实习面经', url:'https://www.nowcoder.com/discuss/7', content:'面试经历。', published_date:''}
  ];
  return Response.json({results});
};
