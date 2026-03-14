/**
 * 游戏状态控制台可视化工具
 *
 * 用于在控制台中直观显示游戏局面，方便调试和测试
 */

import {
  GamePhase,
  TurnType,
  SlotPosition,
  OrientationState,
  CardType,
} from '../shared/types/enums';
import type { GameState } from '../domain/entities/game';
import { getPlayerById, getCardById, getActivePlayer } from '../domain/entities/game';
import type { PlayerState } from '../domain/entities/player';
import { getAvailableEnergyCount, getAllMemberIds } from '../domain/entities/player';
import type { CardInstance, MemberCardData, LiveCardData } from '../domain/entities/card';
import { isMemberCardData, isLiveCardData } from '../domain/entities/card';
import { getCardInSlot, getActiveEnergyIds } from '../domain/entities/zone';
import { getPhaseName as getPhaseNameFromConfig } from '../shared/phase-config';

// ============================================
// 样式常量
// ============================================

const COLORS = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
};

const BOX = {
  topLeft: '┌',
  topRight: '┐',
  bottomLeft: '└',
  bottomRight: '┘',
  horizontal: '─',
  vertical: '│',
  teeDown: '┬',
  teeUp: '┴',
  teeRight: '├',
  teeLeft: '┤',
  cross: '┼',
};

// ============================================
// 可视化器类
// ============================================

/**
 * 游戏状态可视化器
 */
export class GameVisualizer {
  private colorEnabled: boolean;

  constructor(options: { colorEnabled?: boolean } = {}) {
    this.colorEnabled = options.colorEnabled ?? true;
  }

  /**
   * 打印完整的游戏局面
   */
  printGameState(game: GameState): void {
    const lines: string[] = [];

    // 标题
    lines.push(this.formatTitle(game));
    lines.push('');

    // 当前阶段信息
    lines.push(this.formatPhaseInfo(game));
    lines.push('');

    // 玩家2（对手）区域
    lines.push(this.color('=== 玩家2 区域 ===', COLORS.cyan));
    lines.push(...this.formatPlayerArea(game, game.players[1].id, true));
    lines.push('');

    // 分隔线
    lines.push(this.color('─'.repeat(60), COLORS.dim));
    lines.push('');

    // 玩家1 区域
    lines.push(this.color('=== 玩家1 区域 ===', COLORS.green));
    lines.push(...this.formatPlayerArea(game, game.players[0].id, false));
    lines.push('');

    // 动作历史
    if (game.actionHistory.length > 0) {
      lines.push(this.formatRecentActions(game));
    }

    // 输出
    console.log(lines.join('\n'));
  }

  /**
   * 打印简化的游戏状态摘要
   */
  printSummary(game: GameState): void {
    const p1 = game.players[0];
    const p2 = game.players[1];
    const activePlayer = getActivePlayer(game);

    const summary = [
      `回合 ${game.turnCount} | ${this.getPhaseName(game.currentPhase)} | 活跃玩家: ${activePlayer.name}`,
      `${p1.name}: 手牌=${p1.hand.cardIds.length} 能量=${getAvailableEnergyCount(p1)}/${p1.energyZone.cardIds.length} 成员=${getAllMemberIds(p1).length} Live成功=${p1.successZone.cardIds.length}/3`,
      `${p2.name}: 手牌=${p2.hand.cardIds.length} 能量=${getAvailableEnergyCount(p2)}/${p2.energyZone.cardIds.length} 成员=${getAllMemberIds(p2).length} Live成功=${p2.successZone.cardIds.length}/3`,
    ];

    console.log(this.color(summary.join('\n'), COLORS.dim));
  }

  /**
   * 打印单个玩家的手牌
   */
  printHand(game: GameState, playerId: string): void {
    const player = getPlayerById(game, playerId);
    if (!player) return;

    console.log(
      this.color(`${player.name} 的手牌 (${player.hand.cardIds.length}张):`, COLORS.yellow)
    );

    player.hand.cardIds.forEach((cardId, index) => {
      const card = getCardById(game, cardId);
      if (card) {
        console.log(`  ${index + 1}. ${this.formatCard(card)}`);
      }
    });
  }

  /**
   * 打印分隔线
   */
  printSeparator(char: string = '─', length: number = 60): void {
    console.log(this.color(char.repeat(length), COLORS.dim));
  }

  /**
   * 打印带标题的消息
   */
  printAction(message: string): void {
    console.log(this.color(`>>> ${message}`, COLORS.bright + COLORS.yellow));
  }

  /**
   * 打印错误消息
   */
  printError(message: string): void {
    console.log(this.color(`!!! 错误: ${message}`, COLORS.red));
  }

  /**
   * 打印成功消息
   */
  printSuccess(message: string): void {
    console.log(this.color(`✓ ${message}`, COLORS.green));
  }

  // ============================================
  // 私有格式化方法
  // ============================================

  private formatTitle(game: GameState): string {
    return this.color(
      `╔════════════════════════════════════════════════════════════╗\n` +
        `║  游戏 ${game.gameId.substring(0, 20).padEnd(20)} 回合 ${String(game.turnCount).padStart(3)}  ║\n` +
        `╚════════════════════════════════════════════════════════════╝`,
      COLORS.bright
    );
  }

  private formatPhaseInfo(game: GameState): string {
    const activePlayer = getActivePlayer(game);
    const phaseName = this.getPhaseName(game.currentPhase);
    const turnTypeName = this.getTurnTypeName(game.currentTurnType);

    return [
      `当前阶段: ${this.color(phaseName, COLORS.yellow)}`,
      `回合类型: ${turnTypeName}`,
      `活跃玩家: ${this.color(activePlayer.name, COLORS.green)}`,
    ].join(' | ');
  }

  private formatPlayerArea(game: GameState, playerId: string, isOpponent: boolean): string[] {
    const player = getPlayerById(game, playerId);
    if (!player) return ['玩家不存在'];

    const lines: string[] = [];

    // 基本信息
    lines.push(
      `${this.color(player.name, COLORS.bright)} ${player.isFirstPlayer ? '(先攻)' : '(后攻)'}`
    );

    // 资源统计
    lines.push(
      `  卡组: ${player.mainDeck.cardIds.length}张 | ` +
        `能量卡组: ${player.energyDeck.cardIds.length}张 | ` +
        `休息室: ${player.waitingRoom.cardIds.length}张`
    );

    // 手牌
    lines.push(
      `  手牌: ${player.hand.cardIds.length}张` +
        (isOpponent ? ' (隐藏)' : ` ${this.formatHandCards(game, player)}`)
    );

    // 舞台
    lines.push('  舞台:');
    lines.push(this.formatStage(game, player));

    // 能量区
    lines.push(this.formatEnergyZone(game, player));

    // Live 区
    if (player.liveZone.cardIds.length > 0) {
      lines.push(`  Live区: ${player.liveZone.cardIds.length}张`);
    }

    // 成功 Live
    lines.push(
      `  成功Live: ${this.color(`${player.successZone.cardIds.length}/3`, player.successZone.cardIds.length >= 3 ? COLORS.green : COLORS.white)}`
    );

    return lines;
  }

  private formatHandCards(game: GameState, player: PlayerState): string {
    const cards = player.hand.cardIds
      .map((id) => getCardById(game, id))
      .filter((c): c is CardInstance => c !== null);

    if (cards.length === 0) return '(空)';

    const summary: string[] = [];
    const memberCards = cards.filter((c) => c.data.cardType === CardType.MEMBER);
    const liveCards = cards.filter((c) => c.data.cardType === CardType.LIVE);

    if (memberCards.length > 0) {
      summary.push(`${memberCards.length}成员`);
    }
    if (liveCards.length > 0) {
      summary.push(`${liveCards.length}Live`);
    }

    return `[${summary.join(', ')}]`;
  }

  private formatStage(game: GameState, player: PlayerState): string {
    const slots = [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT];
    const slotStrings = slots.map((slot) => {
      const cardId = getCardInSlot(player.memberSlots, slot);
      if (!cardId) {
        return this.color('[空]', COLORS.dim);
      }

      const card = getCardById(game, cardId);
      if (!card) return '[?]';

      const state = player.memberSlots.cardStates.get(cardId);
      const orientation = state?.orientation === OrientationState.WAITING ? '横' : '纵';

      if (isMemberCardData(card.data)) {
        const data = card.data as MemberCardData;
        return `[${data.name.substring(0, 6)} C${data.cost} ${orientation}]`;
      }

      return `[${card.data.name.substring(0, 8)}]`;
    });

    const slotNames = ['左', '中', '右'];
    return '    ' + slotStrings.map((s, i) => `${slotNames[i]}:${s}`).join(' ');
  }

  private formatEnergyZone(game: GameState, player: PlayerState): string {
    const total = player.energyZone.cardIds.length;
    const active = getAvailableEnergyCount(player);
    const tapped = total - active;

    return `  能量: ${this.color(String(active), COLORS.green)}活跃 / ${this.color(String(tapped), COLORS.yellow)}待机 (共${total}张)`;
  }

  private formatCard(card: CardInstance): string {
    const { data } = card;

    if (isMemberCardData(data)) {
      const memberData = data as MemberCardData;
      return `${this.color('[成员]', COLORS.cyan)} ${memberData.name} (费用:${memberData.cost}, 光棒:${memberData.blade})`;
    }

    if (isLiveCardData(data)) {
      const liveData = data as LiveCardData;
      return `${this.color('[Live]', COLORS.magenta)} ${liveData.name} (分数:${liveData.score})`;
    }

    return `${this.color('[能量]', COLORS.yellow)} ${data.name}`;
  }

  private formatRecentActions(game: GameState): string {
    const recent = game.actionHistory.slice(-5);
    const lines = ['最近动作:'];

    recent.forEach((action) => {
      lines.push(`  ${action.type}: ${JSON.stringify(action.payload).substring(0, 50)}`);
    });

    return this.color(lines.join('\n'), COLORS.dim);
  }

  private getPhaseName(phase: GamePhase): string {
    return getPhaseNameFromConfig(phase);
  }

  private getTurnTypeName(turnType: TurnType): string {
    const names: Record<TurnType, string> = {
      [TurnType.FIRST_PLAYER_TURN]: '先攻回合',
      [TurnType.SECOND_PLAYER_TURN]: '后攻回合',
      [TurnType.LIVE_PHASE]: 'Live阶段',
    };
    return names[turnType] ?? '未知';
  }

  private color(text: string, color: string): string {
    if (!this.colorEnabled) return text;
    return `${color}${text}${COLORS.reset}`;
  }
}

/**
 * 默认可视化器实例
 */
export const gameVisualizer = new GameVisualizer();
