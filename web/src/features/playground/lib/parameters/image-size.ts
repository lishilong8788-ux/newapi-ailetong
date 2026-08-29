/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/

/**
 * Turns the aspect-ratio chip into the `size` an image request must carry.
 *
 * Sending no `size` is not a neutral default: channels that bill images per
 * resolution tier reject the request outright rather than assuming one. The
 * aggregator upstream answers such a request with a 500 whose body reads
 * "无法匹配当前分辨率计费档位，仅支持文生图、图生图，可用分辨率：1K、2K" — it
 * resolves the pixel size to a tier and has nothing to resolve when the field is
 * absent. Nothing local catches this first: these models are priced per call, so
 * `ImageRequest.GetTokenCountMeta` leaves the ratio at 1 for every non-`dall-e`
 * model and never inspects `size`.
 *
 * So every ratio maps to a concrete pixel size, including the adaptive one.
 */
import type { ParamChipValues } from './param-chip-values'

/**
 * Pixel sizes for each ratio the image chip offers, all within the 1K tier.
 *
 * 1K is both the cheapest tier and the upstream's own default. Staying inside it
 * means the ratio chip changes framing without silently changing what a
 * generation costs — on `qwen-image-3.0-pro` the 2K tier is roughly double.
 */
const RATIO_TO_SIZE: Record<string, string> = {
  '1:1': '1024x1024',
  '3:2': '1280x853',
  '2:3': '853x1280',
  '16:9': '1280x720',
  '9:16': '720x1280',
}

/**
 * What `auto` resolves to. The adaptive option means "let the model frame the
 * shot", which is a prompt concern; the tier still has to be pinned, so it takes
 * the square 1K size rather than being omitted.
 */
const ADAPTIVE_SIZE = '1024x1024'

/**
 * The `size` to send for the current chip state.
 *
 * Falls back to the adaptive size for an unset chip and for any value not in the
 * table, because the failure mode of guessing wrong here is a rejected request,
 * while the failure mode of a slightly different frame is a different-looking
 * image.
 */
export function resolveImageSize(values: ParamChipValues): string {
  const ratio = values.aspect_ratio
  if (!ratio || ratio === 'auto') return ADAPTIVE_SIZE

  return RATIO_TO_SIZE[ratio] ?? ADAPTIVE_SIZE
}
