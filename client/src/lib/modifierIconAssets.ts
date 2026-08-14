import { HeartColor } from '@game/shared/types/enums';
import bladeIcon from '@/assets/modifier-icons/blade.png';
import bladeHeartAllIcon from '@/assets/modifier-icons/blade_heart_all.png';
import bladeHeartBlueIcon from '@/assets/modifier-icons/blade_heart_blue.png';
import bladeHeartGreenIcon from '@/assets/modifier-icons/blade_heart_green.png';
import bladeHeartPinkIcon from '@/assets/modifier-icons/blade_heart_pink.png';
import bladeHeartPurpleIcon from '@/assets/modifier-icons/blade_heart_purple.png';
import bladeHeartRedIcon from '@/assets/modifier-icons/blade_heart_red.png';
import bladeHeartYellowIcon from '@/assets/modifier-icons/blade_heart_yellow.png';
import costIcon from '@/assets/modifier-icons/cost.png';
import heartAllIcon from '@/assets/modifier-icons/heart_all.png';
import heartBlueIcon from '@/assets/modifier-icons/heart_blue.png';
import heartGrayIcon from '@/assets/modifier-icons/heart_gray.png';
import heartGreenIcon from '@/assets/modifier-icons/heart_green.png';
import heartOrangeIcon from '@/assets/modifier-icons/heart_orange.png';
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
  | 'heart_orange'
  | 'heart_gray'
  | 'heart_all'
  | 'blade_heart_pink'
  | 'blade_heart_red'
  | 'blade_heart_yellow'
  | 'blade_heart_green'
  | 'blade_heart_blue'
  | 'blade_heart_purple'
  | 'blade_heart_all'
  | 'blade'
  | 'cost';

export const MODIFIER_ICON_SOURCE: Record<ModifierIconName, string> = {
  heart_pink: heartPinkIcon,
  heart_red: heartRedIcon,
  heart_yellow: heartYellowIcon,
  heart_green: heartGreenIcon,
  heart_blue: heartBlueIcon,
  heart_purple: heartPurpleIcon,
  heart_orange: heartOrangeIcon,
  heart_gray: heartGrayIcon,
  heart_all: heartAllIcon,
  blade_heart_pink: bladeHeartPinkIcon,
  blade_heart_red: bladeHeartRedIcon,
  blade_heart_yellow: bladeHeartYellowIcon,
  blade_heart_green: bladeHeartGreenIcon,
  blade_heart_blue: bladeHeartBlueIcon,
  blade_heart_purple: bladeHeartPurpleIcon,
  blade_heart_all: bladeHeartAllIcon,
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
  [HeartColor.ORANGE]: 'heart_orange',
  [HeartColor.GRAY]: 'heart_gray',
  [HeartColor.RAINBOW]: 'heart_all',
};

export const HEART_REQUIREMENT_ICON_NAME_BY_COLOR: Record<HeartColor, ModifierIconName> = {
  [HeartColor.PINK]: 'heart_pink',
  [HeartColor.RED]: 'heart_red',
  [HeartColor.YELLOW]: 'heart_yellow',
  [HeartColor.GREEN]: 'heart_green',
  [HeartColor.BLUE]: 'heart_blue',
  [HeartColor.PURPLE]: 'heart_purple',
  [HeartColor.ORANGE]: 'heart_orange',
  [HeartColor.GRAY]: 'heart_gray',
  [HeartColor.RAINBOW]: 'heart_gray',
};

export const HEART_ICON_SOURCE_BY_COLOR: Record<HeartColor, string> = {
  [HeartColor.PINK]: MODIFIER_ICON_SOURCE.heart_pink,
  [HeartColor.RED]: MODIFIER_ICON_SOURCE.heart_red,
  [HeartColor.YELLOW]: MODIFIER_ICON_SOURCE.heart_yellow,
  [HeartColor.GREEN]: MODIFIER_ICON_SOURCE.heart_green,
  [HeartColor.BLUE]: MODIFIER_ICON_SOURCE.heart_blue,
  [HeartColor.PURPLE]: MODIFIER_ICON_SOURCE.heart_purple,
  [HeartColor.ORANGE]: MODIFIER_ICON_SOURCE.heart_orange,
  [HeartColor.GRAY]: MODIFIER_ICON_SOURCE.heart_gray,
  [HeartColor.RAINBOW]: MODIFIER_ICON_SOURCE.heart_all,
};

export const HEART_REQUIREMENT_ICON_SOURCE_BY_COLOR: Record<HeartColor, string> = {
  [HeartColor.PINK]: MODIFIER_ICON_SOURCE.heart_pink,
  [HeartColor.RED]: MODIFIER_ICON_SOURCE.heart_red,
  [HeartColor.YELLOW]: MODIFIER_ICON_SOURCE.heart_yellow,
  [HeartColor.GREEN]: MODIFIER_ICON_SOURCE.heart_green,
  [HeartColor.BLUE]: MODIFIER_ICON_SOURCE.heart_blue,
  [HeartColor.PURPLE]: MODIFIER_ICON_SOURCE.heart_purple,
  [HeartColor.ORANGE]: MODIFIER_ICON_SOURCE.heart_orange,
  [HeartColor.GRAY]: MODIFIER_ICON_SOURCE.heart_gray,
  [HeartColor.RAINBOW]: MODIFIER_ICON_SOURCE.heart_gray,
};
