import { HeartColor } from '@game/shared/types/enums';
import bladeIcon from '@/assets/modifier-icons/blade.png';
import costIcon from '@/assets/modifier-icons/cost.png';
import heartAllIcon from '@/assets/modifier-icons/heart_all.png';
import heartBlueIcon from '@/assets/modifier-icons/heart_blue.png';
import heartGreenIcon from '@/assets/modifier-icons/heart_green.png';
import heartPinkIcon from '@/assets/modifier-icons/heart_pink.png';
import heartPurpleIcon from '@/assets/modifier-icons/heart_purple.png';
import heartRedIcon from '@/assets/modifier-icons/heart_red.png';
import heartYellowIcon from '@/assets/modifier-icons/heart_yellow.png';

export type ModifierIconName =
  | 'heart_pink'
  | 'heart_red'
  | 'heart_yellow'
  | 'heart_green'
  | 'heart_blue'
  | 'heart_purple'
  | 'heart_all'
  | 'blade'
  | 'cost';

export const MODIFIER_ICON_SOURCE: Record<ModifierIconName, string> = {
  heart_pink: heartPinkIcon,
  heart_red: heartRedIcon,
  heart_yellow: heartYellowIcon,
  heart_green: heartGreenIcon,
  heart_blue: heartBlueIcon,
  heart_purple: heartPurpleIcon,
  heart_all: heartAllIcon,
  blade: bladeIcon,
  cost: costIcon,
};

export const HEART_ICON_NAME_BY_COLOR: Record<HeartColor, ModifierIconName> = {
  [HeartColor.PINK]: 'heart_pink',
  [HeartColor.RED]: 'heart_red',
  [HeartColor.YELLOW]: 'heart_yellow',
  [HeartColor.GREEN]: 'heart_green',
  [HeartColor.BLUE]: 'heart_blue',
  [HeartColor.PURPLE]: 'heart_purple',
  [HeartColor.RAINBOW]: 'heart_all',
};

export const HEART_ICON_SOURCE_BY_COLOR: Record<HeartColor, string> = {
  [HeartColor.PINK]: MODIFIER_ICON_SOURCE.heart_pink,
  [HeartColor.RED]: MODIFIER_ICON_SOURCE.heart_red,
  [HeartColor.YELLOW]: MODIFIER_ICON_SOURCE.heart_yellow,
  [HeartColor.GREEN]: MODIFIER_ICON_SOURCE.heart_green,
  [HeartColor.BLUE]: MODIFIER_ICON_SOURCE.heart_blue,
  [HeartColor.PURPLE]: MODIFIER_ICON_SOURCE.heart_purple,
  [HeartColor.RAINBOW]: MODIFIER_ICON_SOURCE.heart_all,
};
