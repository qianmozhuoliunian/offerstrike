// Recommendation only uses explicit self-assessments and recorded practice.
// An unassessed question is never described as a knowledge gap.
const DAY = 24 * 60 * 60 * 1000;
const intervals = { revisit: 1, unassessed: 3, comfortable: 7 };

function timestamp(value) {
  const result = Date.parse(value || '');
  return Number.isFinite(result) ? result : null;
}

function groupQuestions(candidates, role) {
  const grouped = new Map();
  for (const candidate of candidates) {
    if (candidate.role !== role || typeof candidate.text !== 'string' || !candidate.text.trim()) continue;
    const text = candidate.text.trim();
    if (!grouped.has(text)) grouped.set(text, { ...candidate, text, sources: [], topics: [], questionRefs: [] });
    const group = grouped.get(text);
    if(candidate.question_ref && !group.questionRefs.some(ref=>ref.kind===candidate.question_ref.kind && ref.id===candidate.question_ref.id)) group.questionRefs.push(candidate.question_ref);
    const source = {
      id: candidate.sourceId || '',
      title: candidate.sourceTitle || '来源未知',
      url: candidate.sourceUrl || '',
      date: candidate.sourceDate || '',
      type: candidate.sourceType || '来源未知',
      interviewDate: candidate.interviewDate || ''
    };
    const key = source.id || JSON.stringify([source.title,source.url,source.type]);
    if (!group.sources.some(item => item.key === key)) group.sources.push({ key, ...source });
    if (candidate.topic && !group.topics.includes(candidate.topic)) group.topics.push(candidate.topic);
  }
  return [...grouped.values()].map(group => ({
    ...group,
    sources: group.sources.map(({key,...source}) => source),
    sourceTitle: group.sources[0]?.title || '来源未知',
    sourceUrl: group.sources[0]?.url || '',
    question_ref:group.questionRefs[0] || null
  }));
}

export function recommendFromHistory({ role, candidates, attempts, now = new Date(), excludeText = '', deprioritizedIds = [] }) {
  const currentTime = now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (!Number.isFinite(currentTime)) throw Error('推荐时间无效');
  const questions = groupQuestions(candidates, role);
  if (!questions.length) return null;

  const byReference=new Map(), legacyByText=new Map();
  for(const attempt of attempts) {
    if(attempt.role!==role || attempt.refKind==='none') continue;
    if(attempt.refKind) {
      const key=attempt.refKind+'\0'+attempt.refId;
      if(!byReference.has(key)) byReference.set(key,[]);
      byReference.get(key).push(attempt);
    } else if(typeof attempt.question==='string') {
      const key=attempt.question.trim();
      if(!legacyByText.has(key)) legacyByText.set(key,[]);
      legacyByText.get(key).push(attempt);
    }
  }

  const ranked = questions.map((question,index) => {
    // Linked attempts follow their stable reference even when question text changes.
    // Historical rows without a link are tentatively matched by text only when a
    // single candidate exists. Newly entered free text is explicitly 'none'.
    const refs=question.questionRefs || [];
    const records=refs.flatMap(ref=>byReference.get(ref.kind+'\0'+ref.id) || []);
    if(refs.length<=1) {
      const candidateCreated=timestamp(question.questionCreated);
      records.push(...(legacyByText.get(question.text) || []).filter(a=>{const attemptTime=timestamp(a.created);return candidateCreated===null || (attemptTime!==null && candidateCreated<=attemptTime);}));
    }
    // SQLite timestamps are ISO strings; use id as a stable tie-breaker.
    records.sort((a,b) => (timestamp(b.created) ?? -Infinity) - (timestamp(a.created) ?? -Infinity) || String(b.id || '').localeCompare(String(a.id || '')));
    const latest = records[0];
    const rating = latest && ['revisit','comfortable'].includes(latest.rating) ? latest.rating : 'unassessed';
    const lastTime = latest ? timestamp(latest.created) : null;
    const age = lastTime === null ? null : Math.max(0, Math.floor((currentTime - lastTime) / DAY));
    const due = age !== null && age >= intervals[rating];
    const repeated = rating !== 'revisit' && refs.some(ref=>deprioritizedIds.includes(ref.id));
    const rank = repeated ? 7 : !latest ? 1 : rating === 'revisit' && due ? 0 : rating === 'unassessed' && due ? 2 : rating === 'comfortable' && due ? 3 : rating === 'revisit' ? 4 : rating === 'unassessed' ? 5 : 6;
    const reason = !latest ? '尚未练习' : rating === 'revisit' ? '你标记为需要再练' : rating === 'comfortable' ? '你标记为比较熟悉' : '练习后尚未自评';
    const recent = age === null ? '最近练习时间未知' : age === 0 ? '今天练习过' : `${age} 天前练习过`;
    const legacy=records.some(a=>!a.refKind);
    const reasonDetails = !latest ? '可以先试答，尚未练习不代表不会。' : `${recent}，共练习 ${records.length} 次。${due ? '已到建议复习时间。' : age === null ? '' : `建议间隔 ${intervals[rating]} 天。`}${legacy ? '部分旧记录按文字匹配，来源未核实。' : ''}`;
    const availability = !latest ? 'new' : age === null ? 'unknown' : due ? 'due' : 'early';
    return { question, rank, count:records.length, lastTime, index, reason, reasonDetails, availability, rating:latest ? rating : 'unassessed',lastAttemptId:latest?.id || null };
  });
  ranked.sort((a,b) => a.rank-b.rank || a.count-b.count || (a.lastTime ?? Infinity)-(b.lastTime ?? Infinity) || a.index-b.index);
  const current = typeof excludeText === 'string' ? excludeText.trim() : '';
  const otherReady = ranked.find(item => item.question.text !== current && ['new','due'].includes(item.availability));
  const selected=otherReady || (current ? ranked.find(item => item.question.text === current) : null) || ranked[0];
  return { ...selected.question, reason:selected.reason, reasonDetails:selected.reasonDetails, practiceCount:selected.count, lastAttemptId:selected.lastAttemptId,
    lastPracticedAt:selected.lastTime === null ? '' : new Date(selected.lastTime).toISOString(), selfAssessment:selected.rating, availability:selected.availability, sameAsCurrent:!!current && selected.question.text === current };
}
