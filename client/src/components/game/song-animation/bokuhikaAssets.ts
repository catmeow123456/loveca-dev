import song from './assets/bokuhika.png';
import honoka from './assets/PL!-bp5-001-P.webp';
import eli from './assets/PL!-bp5-002-P.webp';
import kotori from './assets/PL!-bp5-003-P.webp';
import umi from './assets/PL!-bp5-004-P.webp';
import rin from './assets/PL!-bp5-005-P.webp';
import maki from './assets/PL!-bp5-006-P.webp';
import nozomi from './assets/PL!-bp5-007-P.webp';
import hanayo from './assets/PL!-bp5-008-P.webp';
import nico from './assets/PL!-bp5-009-P.webp';

export const bokuhikaSongImage = song;
const portraits: Readonly<Record<string, string>> = {
  'PL!-bp5-001-P': honoka,
  'PL!-bp5-002-P': eli,
  'PL!-bp5-003-P': kotori,
  'PL!-bp5-004-P': umi,
  'PL!-bp5-005-P': rin,
  'PL!-bp5-006-P': maki,
  'PL!-bp5-007-P': nozomi,
  'PL!-bp5-008-P': hanayo,
  'PL!-bp5-009-P': nico,
};
export const bokuhikaPortraitImage = (code: string): string => portraits[code];
