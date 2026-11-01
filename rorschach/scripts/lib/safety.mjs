// Words that stop the test. It errs towards pausing: a false alarm costs one gentle question.
import { norm } from './transcript.mjs';

const CRISIS = /(自杀|自尽|轻生|寻死|自残|不想活|不想再活|活不下去|活着(真|都|也)?没(什么|有|啥)?意思|结束(自己的)?生命|想死|想去死|死了算了|不如死了|割腕|跳楼|上吊|伤害自己|伤害别人|杀了自己|了结自己)/;
export const isCrisis = text => CRISIS.test(norm(text));
