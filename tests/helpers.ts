import type { Answers, AnswerValue } from '../src/assessment/scoring';

/** 按题目顺序构造一份答题，未列出的题保持未答 */
export function makeAnswers(pairs: [string, AnswerValue][]): Answers {
  const a: Answers = {};
  for (const [id, v] of pairs) a[id] = v;
  return a;
}

/**
 * 一个「兴趣均匀、硬条件都往宽处答」的中性人，用来做基准与差值比较。
 * 注意他**不是**「什么都不罚」的人：学制答 5 年，所以回本慢的专业会吃到延迟兑现扣分
 * （早期给的是 y8，那条规则恒为 0，所有以它为基线的差值断言其实跑在死区里）。
 */
export function neutralAnswers(overrides: [string, AnswerValue][] = []): Answers {
  return makeAnswers([
    ['f_subjects', ['physics', 'chemistry']],
    ['f_subject_confirmed', 'yes'],
    ['f_color', 'normal'],
    ['f_vision', 'ok'],
    ['f_years', 'y5'],
    ['f_tuition', 'ok'],
    ['f_postgrad', 'probably'],
    ['e_fix', 'class'],
    ['e_why', 'before'],
    ['e_show', 'none'],
    ['e_teach', 'ad_hoc'],
    ['e_lead', 'tried'],
    ['e_system', 'some'],
    ['e_money', 'none'],
    ['e_alone', 'ok'],
    ['e_emotion', 'help_but_tired'],
    ['e_precise', 'did'],
    ['e_code', 'course'],
    ['e_grit', 'one'],
    ['t_math', 'ok'],
    ['t_proof', 'patient'],
    ['t_memorize', 'once_hard'],
    ['t_lab', 'desk'],
    ['t_visual', 'tolerate'],
    ['t_write', 'with_effort'],
    ['t_data', 'fine'],
    ['t_people_daily', 'manageable'],
    ['t_field', 'hospital'],
    ['t_deadline', 'survive'],
    ['v_stable_income', 'stable'],
    ['v_meaning_money', 'money'],
    ['v_prestige_free', 'unknown'],
    ['v_delay', 'depends'],
    ['v_shrink', 'pragmatic'],
    ['v_depth', 'deep'],
    ['v_solved', 'defined'],
    ['v_applied', 'use'],
    ['v_family', 'argue'],
    ...overrides,
  ]);
}
