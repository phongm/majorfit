import { CAREER_BARRIER_LABEL, CAREER_FIT_LABEL, type CareerPath } from '../domain/types';

/** 正文最多列几条 */
const LIMIT = 3;

/**
 * 选行规则：正门和侧门/顺路**各保底一条**，剩下的按数据原顺序（典型度）填满，
 * 最后仍按原顺序输出。
 *
 * 两个失败模式都被实测抓到过：
 * - 直接 slice(0,3)：23 张卡把唯一的侧门/顺路砍掉了，而那行往往最有决策价值
 *   （心理学「精神科医师［顺路］本科不能考临床执医」）。
 * - 只补「第一条被挤出的非正门」：数据不是按 fit 排序的，于是工商管理那张卡
 *   连列三条侧门，把「考公［正门］」留在了折叠区里 —— 反方向犯同一个错。
 */
export function pickPaths(paths: CareerPath[]): CareerPath[] {
  if (paths.length <= LIMIT) return paths;
  const wanted = new Set<CareerPath>();
  const firstMain = paths.find((p) => p.fit === 'main');
  const firstOff = paths.find((p) => p.fit !== 'main');
  if (firstMain) wanted.add(firstMain);
  if (firstOff) wanted.add(firstOff);
  for (const p of paths) {
    if (wanted.size >= LIMIT) break;
    wanted.add(p);
  }
  return paths.filter((p) => wanted.has(p));
}

interface Props {
  paths: CareerPath[];
  /** 对照区空间紧，只标定位不标门槛 */
  withBarrier?: boolean;
  /** 被折起的行在哪里能看到；不给就说明哪儿都没有，只能报个数 */
  where?: string;
}

/**
 * 去向列表。徽章一律中性描边：绿/橙/红在这页已经被「数据可靠度」占用
 * （来源徽章「已逐条核对」就是绿的），再让「正门」也绿就会被读成「这岗位好」。
 * 三档的意思由文字承担。
 */
export default function CareerPaths({ paths, withBarrier = false, where }: Props) {
  const shown = pickPaths(paths);
  const hidden = paths.length - shown.length;
  return (
    <ul className="list careers">
      {shown.map((p) => (
        <li key={p.name}>
          {/* li 保持 list-item 才画得出圆点；flex 放在内层，否则 ::marker 会消失 */}
          <div className="career-row">
            <b>{p.name}</b>
            {/* 徽章之间没有可见空格，读屏会把整行连读成「…顾问正门本科可入」 */}
            <span className="sr-only">，入口定位：</span>
            <span className="badge fit">{CAREER_FIT_LABEL[p.fit]}</span>
            {withBarrier && (
              <>
                <span className="sr-only">，学历门槛：</span>
                <span className="badge fit">{CAREER_BARRIER_LABEL[p.entryBarrier]}</span>
              </>
            )}
          </div>
          {p.note && <div className="note">{p.note}</div>}
        </li>
      ))}
      {/* 折行必须说出来：对照区没有折叠详情，不报数就是静默吞信息 */}
      {hidden > 0 && (
        <li className="careers-more">
          {where ? `另外 ${hidden} 条去向在${where}里。` : `另有 ${hidden} 条去向没列出来。`}
        </li>
      )}
    </ul>
  );
}
