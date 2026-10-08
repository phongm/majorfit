import type { MajorProfile } from '../../domain/types';
import { COMPUTING_MAJORS } from './computing';
import { EE_MECH_MAJORS } from './ee-mech';
import { CIVIL_CHEM_MAJORS } from './civil-chem';
import { SCIENCE_MAJORS } from './science';
import { MEDICINE_AGRO_MAJORS } from './medicine-agro';
import { ECON_LAW_MGMT_MAJORS } from './econ-law-mgmt';
import { HUMANITIES_ARTS_EDU_MAJORS } from './humanities-arts';

export const ALL_MAJORS: MajorProfile[] = [
  ...COMPUTING_MAJORS,
  ...EE_MECH_MAJORS,
  ...CIVIL_CHEM_MAJORS,
  ...SCIENCE_MAJORS,
  ...MEDICINE_AGRO_MAJORS,
  ...ECON_LAW_MGMT_MAJORS,
  ...HUMANITIES_ARTS_EDU_MAJORS,
];

const seen = new Set<string>();
for (const m of ALL_MAJORS) {
  if (seen.has(m.id)) throw new Error(`专业 id 重复：${m.id}（${m.name}）`);
  seen.add(m.id);
  if (m.honestDrawbacks.length === 0) {
    throw new Error(`${m.name} 缺少 honestDrawbacks：空值视为数据缺失，不允许当作「没有缺点」`);
  }
}

export const MAJORS_BY_ID = new Map(ALL_MAJORS.map((m) => [m.id, m]));
