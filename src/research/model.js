import {createAiTransport} from '../ai-transport.js';

export function createResearchModel({key,model,baseUrl,fetcher,request=createAiTransport({key,model,baseUrl,fetcher})}) {
  if (!request) return undefined;
  return async ({instructions,payload,signal,maxTokens}) => {
    const response=await request({max_tokens:maxTokens,response_format:{type:'json_object'},temperature:0.2,
      messages:[{role:'system',content:instructions},{role:'user',content:payload}]},
      AbortSignal.any([signal,AbortSignal.timeout(20000)]));
    if (!response.ok) throw Error('AI 服务暂不可用');
    const data=await response.json();
    return {content:data.choices?.[0]?.message?.content,usage:data.usage};
  };
}
