const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  if (String(url)==='https://mock-role.test/v1/chat/completions') {
    const request=JSON.parse(options.body);
    const role=JSON.parse(request.messages.at(-1).content).role;
    const status=role==='科比' ? 'invalid' : role==='AI' ? 'uncertain' : 'valid';
    return Response.json({choices:[{message:{content:JSON.stringify({status})}}]});
  }
  if (String(url) !== 'https://api.tavily.com/search') return originalFetch(url, options);
  const query = JSON.parse(options.body).query;
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
