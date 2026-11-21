export function renderAbilityEvaluation(evaluation,escapeHtml) {
  if (!evaluation) return '';
  const {topic,strengths,weaknesses,unverified,followup_point,recommended_action}=evaluation;
  const group = (label,items,render)=>items.length
    ? `<p><strong>${label}</strong></p><ul>${items.map(item=>`<li>${render(item)}</li>`).join('')}</ul>` : '';
  const observed=({point,evidence,requirement})=>`${escapeHtml(point)}<br>回答摘录：「${escapeHtml(evidence)}」${requirement?`<br>题目要求：「${escapeHtml(requirement)}」`:''}`;
  const next=recommended_action==='followup' ? `追问重点：${followup_point}` :
    recommended_action==='review' ? '建议后续复习' : '可以结束本题';
  return `<details class="coaching-details"><summary>查看本轮能力评价${topic?' · '+escapeHtml(topic):''}</summary>
    ${group('本轮正确点',strengths,observed)}
    ${group('本轮错误',weaknesses.filter(item=>item.type==='incorrect'),observed)}
    ${group('本轮遗漏',weaknesses.filter(item=>item.type==='missing'),observed)}
    ${group('尚未验证',unverified,escapeHtml)}
    <p>${escapeHtml(next)}</p>
  </details>`;
}
