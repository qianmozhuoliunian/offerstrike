export function createFastApiRetrieval(address, fetcher = fetch) {
  const base = new URL(address);
  if (base.protocol !== 'http:' || base.hostname !== '127.0.0.1' ||
      base.username || base.password || base.pathname !== '/' || base.search || base.hash) {
    throw Error('RESEARCH_SERVICE_URL 必须是本机地址，例如 http://127.0.0.1:8091');
  }
  const endpoint = new URL('/v1/retrieve', base);
  return async ({provider, role, company, domains, phrase, from, today}) => {
    const response = await fetcher(endpoint, {
      method:'POST', redirect:'error', signal:AbortSignal.timeout(13_000),
      headers:{'content-type':'application/json'},
      body:JSON.stringify({provider, role, company, domains, phrase,
        from_date:from ?? null, through_date:from ? today : null})
    });
    if (!response.ok) throw Error('Python 研究服务检索失败');
    const data = await response.json();
    if (!Array.isArray(data?.results)) throw Error('Python 研究服务返回格式无效');
    return data.results;
  };
}
