export function createResearchModel({key,model,baseUrl,fetcher=fetch}) {
  if (!key || !model) return undefined;
  return async ({instructions,payload,signal,maxTokens}) => {
    const base=(baseUrl || 'https://api.openai.com/v1').replace(/\/$/,'');
    const response=await fetcher(`${base}/chat/completions`,{
      method:'POST',signal:AbortSignal.any([signal,AbortSignal.timeout(20000)]),
      headers:{'content-type':'application/json',authorization:`Bearer ${key}`},
      body:JSON.stringify({model,max_tokens:maxTokens,response_format:{type:'json_object'},temperature:0.2,
        ...(new URL(base).hostname==='api.deepseek.com'?{thinking:{type:'disabled'}}:{}),
        messages:[{role:'system',content:instructions},{role:'user',content:payload}]})
    });
    if (!response.ok) throw Error('AI 服务暂不可用');
    const data=await response.json();
    return {content:data.choices?.[0]?.message?.content,usage:data.usage};
  };
}
