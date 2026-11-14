// Guidance reads existing state only; it never seeds a user's library with samples.
export function renderGettingStarted(state) {
  const panel = document.querySelector('#getting-started');
  if (!panel) return;
  document.querySelector('#search-config-hint').hidden = !!state.searchConfigured;
  document.querySelector('#practice-config-hint').hidden = !!state.aiConfigured;
  const find = document.querySelector('#role-next-find');
  find.dataset.next = state.searchConfigured ? 'search' : 'source';
  find.querySelector('strong').textContent = state.searchConfigured ? '搜索面经 →' : '录入已有面经 →';
  find.querySelector('span').textContent = state.searchConfigured ? '按目标岗位查找公开资料' : '填写原帖链接，无需配置搜索服务';
  const sources = (state.sources || []).filter(source => source.role === state.role);
  const hasQuestions = sources.some(source => source.questions?.length) ||
    (state.debriefs || []).some(item => item.role === state.role && item.include_in_library);
  const attempts = (state.attempts || []).filter(item => item.role === state.role);
  const hasRatedQuestion = attempts.some(item => item.question_link_available === 1 &&
    ['revisit', 'comfortable'].includes(item.rating));
  panel.hidden = !!state.role && hasQuestions && hasRatedQuestion;

  let title, description, action, tab;
  if (!state.role || state.roleValidation === 'unverified') {
    title = '第一步，确定你要准备的岗位';
    description = '保存目标岗位后，找一篇面经、核对一道题，再回答并自评。没有服务密钥也可以手动录题和练习。';
    action = state.role ? '核对目标岗位' : '设置目标岗位'; tab = 'role';
  } else if (!hasQuestions) {
    title = sources.length ? '从已收藏的原帖中，确认第一道题' : '找一篇与你的岗位相关的面经';
    description = sources.length
      ? '打开资料库中的来源，对照原帖手动添加题目；配置 AI 后也可从粘贴的原文提取候选，核对后再保存。'
      : '可以搜索公开面经，也可以录入已有原帖链接。来源未知时如实标记，不必等待 AI 配置。';
    action = sources.length ? '去资料库整理题目' : state.searchConfigured ? '搜索面经' : '打开资料库';
    tab = sources.length || !state.searchConfigured ? 'library' : 'search';
  } else {
    title = attempts.length ? '给一次作答自评，安排下次练习' : '题目已准备好，完成第一次作答';
    description = '从题库选题，写下回答后选择「仅保存作答」，在练习记录里自评。下次推荐会参考自评和练习时间，AI 点评可选。';
    action = attempts.length ? '查看练习与自评' : '开始练习'; tab = 'practice';
  }
  document.querySelector('#getting-started-title').textContent = title;
  document.querySelector('#getting-started-description').textContent = description;
  const primary = document.querySelector('#getting-started-next');
  primary.textContent = action; primary.dataset.tab = tab;
  document.querySelector('#getting-started-add').hidden = !state.role || state.roleValidation === 'unverified' || hasQuestions || sources.length > 0;
  document.querySelector('#getting-started-services').textContent = [
    state.searchConfigured ? '搜索已配置，连接待验证' : '搜索未配置，可手动录入来源',
    state.aiConfigured ? 'AI 已配置，连接待验证' : 'AI 未配置，可仅保存作答并自评'
  ].join('；') + '。';
}
