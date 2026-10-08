import { applyConstraints } from '../engine/filters';
import { score } from '../engine/rank';
import { resolveMajor, type ResolvedMajor } from '../data/profiles/derive';
import { CATALOG_MAJORS } from '../data/catalog/2026';
import {
  DERIVED_SCOPE,
  HARD_CONSTRAINTS,
  LOAD_LABELS,
  type CareerPath,
  type ConstraintKind,
  type Recommendation,
  type UserProfile,
} from '../domain/types';
import { sourceOf } from './provenance';
import CareerPaths from './CareerPaths';

const entryByCode = new Map(CATALOG_MAJORS.map((e) => [e.code, e]));

const GAP_LABEL: Record<ConstraintKind, string> = { subject: '选科口径', health: '体检限制', cost: '学费档位' };
interface Props {
  codes: string[];
  profile: UserProfile;
  recommendations: Recommendation[];
  onBrowse: () => void;
}

type Status = 'recommended' | 'feasible' | 'blocked' | 'no_data';

interface Row {
  code: string;
  name: string;
  status: Status;
  source: ReturnType<typeof sourceOf>;
  why?: string;
  score?: number;
  gaps?: string[];
  flags?: string[];
  /** 只有人工核对过的画像才有去向；推断层是空数组 */
  careers?: CareerPath[];
  /** 推断值来自哪一层，代价行只标一次 */
  scopeWord?: string;
  /** 推断层的自述：并列强选、口径不外推这类事必须让用户看到，不然 caveat 只是内部笔记 */
  caveats?: string[];
}

/**
 * 用户自己挑的专业，用同一套评分与同一套硬约束算一遍。
 *
 * 这一节的存在理由不是「你想学就给你加分」，而是把代价摊开：
 * 你挑的方向以你的条件能不能报、哪里超出你的耐受、被哪条规则挡掉。
 */
export default function PickedMajors({ codes, profile, recommendations, onBrowse }: Props) {
  const rankById = new Map(recommendations.map((r) => [r.major.id, r.rank]));
  // 「有没有去招办核对过」是动作，不是资格；混进硬条件计数会说出不存在的缺口
  const missingHard = profile.unmeasured.constraints.filter((k) =>
    (HARD_CONSTRAINTS as readonly string[]).includes(k),
  );

  /** 目录改版后可能有条目被撤销，旧清单里的代码要显式说「不认得」，不能悄悄少一行 */
  const dropped = codes.filter((c) => !entryByCode.has(c));
  const rows: Row[] = codes.filter((c) => entryByCode.has(c)).flatMap((code) => {
    const resolved: ResolvedMajor = resolveMajor(code);
    const entry = entryByCode.get(code);
    const name = resolved?.kind === 'hand_verified' ? resolved.major.name : (entry?.name ?? code);
    const source = sourceOf(resolved);
    if (!resolved) {
      return [{ code, name, status: 'no_data' as Status, source }];
    }

    /**
     * 诊断只回答「以你的条件能不能报、代价多大」。
     * recommendable=false 有两种原因：通道走不进去（真约束，必须显示），
     * 或我们只有推断值（数据问题，与用户无关）。后者抬掉，前者原样保留 ——
     * 抬掉它才不会让 filters 在资格判断处 continue，把选科、体检这些真规则跳过去。
     */
    const outcome = applyConstraints([{ ...resolved.major, recommendable: true }], profile);
    const rank = rankById.get(code);
    const careers = resolved.kind === 'hand_verified' ? resolved.major.careerPaths : [];
    const caveats = resolved.kind === 'derived' ? resolved.major.derivedCaveats : [];
    /** 依据来自同层外推时，不能借用「核对过」的口气 */
    const scopeWord = resolved.kind === 'derived' ? DERIVED_SCOPE[resolved.major.provenance] : '';
    const inferred = scopeWord ? `（依据是${scopeWord}推断值）` : '';

    if (rank) {
      return [{ code, name, status: 'recommended' as Status, source, why: `推荐第 ${rank} 位`, careers }];
    }
    if (outcome.excluded.length) {
      return [
        {
          code,
          name,
          status: 'blocked' as Status,
          source,
          why: `${outcome.excluded[0]!.reason}${inferred}`,
          caveats,
          careers,
        },
      ];
    }
    const s = score(resolved.major, profile);
    const gap = outcome.constraintGaps[0];
    return [
      {
        code,
        name,
        status: 'feasible' as Status,
        source,
        score: Math.round(s.score),
        why: gap
          ? `注意：${gap.missing.map((k) => (GAP_LABEL[k] ?? k)).join('、')}本库没核对，能报不等于确定能报。`
          : '',
        careers,
        gaps: s.breakdown.loadGaps
          .slice(0, 3)
          .map((g) => `${LOAD_LABELS[g.dim]}：要求 ${g.load.toFixed(2)}，你能忍 ${g.tolerance.toFixed(2)}`),
        scopeWord,
        flags: s.breakdown.riskFlags,
        caveats,
      },
    ];
  });

  const head = (s: Status) => rows.filter((r) => r.status === s);

  return (
    <div className="card">
      <h3>你自己挑的 {rows.length} 个专业</h3>
      {missingHard.length > 0 && (
        <p className="note">
          你还有 {missingHard.length} 项硬条件没说过（选科、体检、学制这些，答「没算过」也算没说），所以「能报」是按已知的部分判的，别当成结论。
        </p>
      )}
      {dropped.length > 0 && (
        <p className="note">
          已忽略 {dropped.length} 个不在当前专业目录里的旧选择：{dropped.join('、')}
        </p>
      )}

      {head('recommended').map((r) => (
        <PickedRow key={r.code} r={r} line={r.why!} tone="ok" />
      ))}
      {head('feasible').map((r) => {
        const cost = r.gaps?.length
          ? `代价${r.scopeWord ? `（以下是${r.scopeWord}推断值）` : ''}：${r.gaps.join('；')}`
          : '没有明显超出的负载项';
        return (
          <PickedRow
            key={r.code}
            r={r}
            tone="warn"
            line={`按你现在填的条件能报，评分 ${r.score}。${r.why ?? ''}${cost}`}
            flags={r.flags}
          />
        );
      })}
      {head('blocked').map((r) => (
        <PickedRow key={r.code} r={r} tone="bad" line={`被条件挡掉：${r.why ?? '原因未记录'}`} />
      ))}
      {head('no_data').map((r) => (
        <PickedRow
          key={r.code}
          r={r}
          tone="bad"
          line="这一条没法对照：得去查开设这个方向的院校培养方案，别看名字。"
        />
      ))}

      <div className="block">
        <button className="btn" onClick={onBrowse}>
          再挑几个 / 调整已挑的
        </button>
      </div>
    </div>
  );
}

function PickedRow({ r, line, tone, flags }: { r: Row; line: string; tone: 'ok' | 'warn' | 'bad'; flags?: string[] }) {
  return (
    <div className={`picked-row ${tone}`}>
      <div className="picked-head">
        <b>{r.name}</b>
        <span className="pick-code">{r.code}</span>
        <span className={`badge ${r.source.cls}`}>{r.source.label}</span>
      </div>
      <p className="note" style={{ margin: '4px 0 0' }}>
        {line}
      </p>
      {r.source.note && (
        <p className="note" style={{ margin: '2px 0 0' }}>
          数据来源：{r.source.note}
        </p>
      )}
      {r.status !== 'no_data' &&
        (r.careers && r.careers.length > 0 ? (
          <>
            <p className="note" style={{ margin: '8px 0 0' }}>
              读完大概做什么
            </p>
            <CareerPaths paths={r.careers} />
          </>
        ) : (
          <p className="note" style={{ margin: '6px 0 0' }}>
            去向还没录：本库只给人工核对过的专业写去向。
          </p>
        ))}
      {r.caveats && r.caveats.length > 0 && (
        <>
          {r.caveats.slice(0, 3).map((c, i) => (
            <p className="note" style={{ margin: '2px 0 0' }} key={i}>
              推断说明：{c}
            </p>
          ))}
          {r.caveats.length > 3 && (
            <p className="note" style={{ margin: '2px 0 0' }}>
              还有 {r.caveats.length - 3} 条推断说明没列出来
            </p>
          )}
        </>
      )}
      {flags?.slice(0, 2).map((f, i) => (
        <p className="note" style={{ margin: '2px 0 0' }} key={i}>
          红旗：{f}
        </p>
      ))}
    </div>
  );
}
