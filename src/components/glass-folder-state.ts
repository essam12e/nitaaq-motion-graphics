/** The six states of the GlassPortfolioFolder and the continuous pose they read from (pure; shared with seek and tests). */

export const FOLDER_STATES = ['closed', 'hover', 'pressed', 'opening', 'open', 'exploded'] as const;
export type FolderState = (typeof FOLDER_STATES)[number];

export interface FolderPose {
  /** 0..1 entrance (dips below 0 on anticipation). */
  reveal: number;
  hover: number;
  /** 0..1 compression; below 0 is the release pop. */
  press: number;
  open: number;
  explode: number;
  /** 0..1 click pulse. */
  glow: number;
  /** 0..1 how far focus has moved away from the folder. */
  dim: number;
  /** Specular sweep position across the front pane (omitted: no sweep). */
  sweep?: number;
}

/** The named state a pose reads as. */
export function folderState(p: FolderPose): FolderState {
  if (p.explode > 0.05) return 'exploded';
  if (p.open >= 0.95) return 'open';
  if (p.open > 0.02) return 'opening';
  if (p.press > 0.3) return 'pressed';
  if (p.hover > 0.3) return 'hover';
  return 'closed';
}

const REST_POSE: FolderPose = { reveal: 1, hover: 0, press: 0, open: 0, explode: 0, glow: 0, dim: 0 };

/** The pose of a named state (a still, or the start values of a timeline). */
export function folderPose(state: FolderState): FolderPose {
  switch (state) {
    case 'hover':
      return { ...REST_POSE, hover: 1 };
    case 'pressed':
      return { ...REST_POSE, hover: 1, press: 1 };
    case 'opening':
      return { ...REST_POSE, hover: 0.6, open: 0.5 };
    case 'open':
      return { ...REST_POSE, open: 1 };
    case 'exploded':
      return { ...REST_POSE, open: 1, explode: 1 };
    default:
      return { ...REST_POSE };
  }
}
