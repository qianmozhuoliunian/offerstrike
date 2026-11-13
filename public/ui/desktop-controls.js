export function mountDesktopSettings({flushDraft}) {
  const bridge=window.offerPilotDesktop;
  const form=document.querySelector('#desktop-services');
  if (!bridge || !form) return;
  bridge.onClose(async()=>{await flushDraft().catch(()=>{});});
  form.hidden=false;
  document.querySelector('#settings-storage-place').textContent='当前 Windows 用户的应用数据目录';
  document.querySelector('#settings-search-how').textContent='在上方填写 Tavily 或 Exa 密钥。';
  document.querySelector('#settings-ai-how').textContent='在上方填写模型名称、密钥及服务地址。';
  const status=form.querySelector('[role=status]'), restart=form.querySelector('[data-desktop-restart]');
  const secrets=['TAVILY_API_KEY','EXA_API_KEY','AI_API_KEY'];
  const render=config=>{
    for (const key of secrets) {
      form.elements[key].placeholder=config.configured[key]?'已保存；留空保留':'未配置';
      form.elements[key].value='';
      form.elements['clear_'+key].checked=false;
    }
    form.elements.AI_MODEL.value=config.AI_MODEL;
    form.elements.AI_BASE_URL.value=config.AI_BASE_URL;
  };
  bridge.serviceStatus().then(render).catch(()=>{status.textContent='无法读取服务配置。';});
  form.addEventListener('submit',async e=>{
    e.preventDefault();
    const button=form.querySelector('[type=submit]');
    const values={AI_MODEL:form.elements.AI_MODEL.value,AI_BASE_URL:form.elements.AI_BASE_URL.value};
    for(const key of secrets) {
      if(form.elements['clear_'+key].checked) values[key]='';
      else if(form.elements[key].value.trim()) values[key]=form.elements[key].value;
    }
    button.disabled=true;
    try {render(await bridge.saveServices(values));status.textContent='已保存。重启应用后生效。';restart.hidden=false;}
    catch(error){status.textContent=error.message;}
    finally {button.disabled=false;}
  });
  restart.addEventListener('click',async()=>{
    restart.disabled=true;
    try {await bridge.restart();}
    catch(error) {status.textContent=error.message;restart.disabled=false;}
  });
}
