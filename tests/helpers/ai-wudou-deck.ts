import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { AnyCardData, BladeHeartItem, HeartIcon } from '../../src/domain/entities/card';
import { createHeartRequirement } from '../../src/domain/entities/card';
import { CardDataRegistry } from '../../src/domain/card-data/loader';
import { loadDeckFromYamlString } from '../../src/domain/card-data/deck-loader';
import { CardType } from '../../src/shared/types/enums';

interface ExportCard {
  cardCode: string;
  cardType: CardType;
  nameJp: string;
  nameCn: string;
  workNames: string[] | null;
  groupNames: string[] | null;
  unitName: string | null;
  cardTextJp: string | null;
  cardTextCn: string | null;
  cost: number | null;
  blade: number | null;
  hearts: HeartIcon[] | null;
  bladeHearts: BladeHeartItem[] | null;
  score: number | null;
  requirements: HeartIcon[] | null;
}

/** Selected fields from the user-designated export only; never a runtime card source. */
export function readFrozenWudouDeck() {
  const yaml = readFileSync(new URL('../../assets/decks/无豆虹.yaml', import.meta.url), 'utf8');
  const facts = readFileSync(
    new URL('../fixtures/ai-battle/wudou-nijigasaki.cards.json', import.meta.url),
    'utf8'
  );
  const hash = (value: string) => createHash('sha256').update(value).digest('hex');
  if (
    hash(yaml) !== '922f310d1a786561b64e50ebf4f671299dc196b5cdca29410ec8aeb4e5b5c558' ||
    hash(facts) !== '6f7931f68f74395a4a940344f8d13887731bed7f34b1bd390b80f4a28d944c3f'
  )
    throw new Error('无豆虹构筑或导出事实已变化，请先核对来源与支持矩阵');
  const raw = JSON.parse(facts) as { cards: ExportCard[] };
  const registry = new CardDataRegistry();
  registry.load(raw.cards.map(convert));
  const loaded = loadDeckFromYamlString(yaml, registry);
  if (!loaded.success || !loaded.deck || loaded.warnings.length)
    throw new Error(JSON.stringify({ errors: loaded.errors, warnings: loaded.warnings }));
  return { registry, deck: loaded.deck };
}

function convert(raw: ExportCard): AnyCardData {
  const base = {
    cardCode: raw.cardCode,
    name: raw.nameCn,
    nameJp: raw.nameJp,
    nameCn: raw.nameCn,
    workNames: raw.workNames ?? undefined,
    groupNames: raw.groupNames ?? undefined,
    unitName: raw.unitName ?? undefined,
    cardText: raw.cardTextCn ?? undefined,
    cardTextJp: raw.cardTextJp ?? undefined,
    cardTextCn: raw.cardTextCn ?? undefined,
    bladeHearts: raw.bladeHearts?.length ? raw.bladeHearts : undefined,
  };
  switch (raw.cardType) {
    case CardType.MEMBER:
      if (raw.cost === null || raw.blade === null || !raw.hearts)
        throw new Error(`Incomplete member: ${raw.cardCode}`);
      return {
        ...base,
        cardType: CardType.MEMBER,
        cost: raw.cost,
        blade: raw.blade,
        hearts: raw.hearts,
      };
    case CardType.LIVE:
      if (raw.score === null || !raw.requirements)
        throw new Error(`Incomplete LIVE: ${raw.cardCode}`);
      return {
        ...base,
        cardType: CardType.LIVE,
        score: raw.score,
        requirements: createHeartRequirement(
          Object.fromEntries(raw.requirements.map(({ color, count }) => [color, count]))
        ),
      };
    case CardType.ENERGY:
      return { ...base, cardType: CardType.ENERGY };
    default:
      throw new Error(`Unexpected card type: ${raw.cardCode}`);
  }
}
