// Looseleaf, MIT. See ui/looseleaf/LICENSE.

import type { ArtDef } from "@/ui/looseleaf/lib/ink/art/types";
import { arrows } from "@/ui/looseleaf/lib/ink/art/icons/arrows";
import { marks } from "@/ui/looseleaf/lib/ink/art/icons/marks";
import { status } from "@/ui/looseleaf/lib/ink/art/icons/status";
import { layout } from "@/ui/looseleaf/lib/ink/art/icons/layout";
import { files } from "@/ui/looseleaf/lib/ink/art/icons/files";
import { comms } from "@/ui/looseleaf/lib/ink/art/icons/comms";
import { devData } from "@/ui/looseleaf/lib/ink/art/icons/dev-data";
import { textNatureMisc } from "@/ui/looseleaf/lib/ink/art/icons/text-nature-misc";
import { media } from "@/ui/looseleaf/lib/ink/art/icons/media";
import { commerceTime } from "@/ui/looseleaf/lib/ink/art/icons/commerce-time";

export const iconBatches = {
  arrows,
  marks,
  status,
  layout,
  files,
  comms,
  devData,
  textNatureMisc,
  media,
  commerceTime,
} as const;
export const icons = {
  ...arrows,
  ...marks,
  ...status,
  ...layout,
  ...files,
  ...comms,
  ...devData,
  ...textNatureMisc,
  ...media,
  ...commerceTime,
} satisfies Record<string, ArtDef>;
export type IconName = keyof typeof icons;
export * from "@/ui/looseleaf/lib/ink/art/icons/aliases";
