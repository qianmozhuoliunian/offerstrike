export function validateAiBase(value) {
  let url;
  const address=value || 'https://api.openai.com/v1';
  try {url=new URL(address);}
  catch {throw Error('AI 服务地址无效');}
  if ((url.protocol!=='https:' && !(url.protocol==='http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname))) ||
      url.username || url.password || /[?#]/.test(address)) throw Error('AI 服务地址须使用 HTTPS 或本机 HTTP，且不含凭证、参数或片段');
  return url.href.replace(/\/+$/,'');
}

export function createAiTransport({key,model,baseUrl,fetcher=fetch}) {
  if (!key || !model) return undefined;
  const base = validateAiBase(baseUrl);
  const providerOptions = new URL(base).hostname==='api.deepseek.com' ? {thinking:{type:'disabled'}} : {};
  return (payload, signal) => fetcher(`${base}/chat/completions`,{
    method:'POST',redirect:'error',signal,
    headers:{'content-type':'application/json',authorization:`Bearer ${key}`},
    body:JSON.stringify({...payload,...providerOptions,model})
  });
}
