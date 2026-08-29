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
import type {
  ParamChipSpec,
  PlaygroundCapability,
  PlaygroundModality,
} from './types'

/*
 * There is deliberately no channel-routing chip here.
 *
 * One used to sit at the head of every modality, offering "best overall / price
 * first / speed first / success rate first". No such dial exists on the backend:
 * `middleware.Distribute` either honours a channel id pinned on the token
 * (`ContextKeyTokenSpecificChannelId`) or picks within the group by priority and
 * weight, and the playground's temporary token pins nothing. There is no request
 * field, header or setting that reorders channels by price, latency or success
 * rate — so the chip was not unwired, it was unimplementable, and it promised
 * routing control the product does not have. If such a strategy is ever added
 * upstream, add the chip back together with the field that carries it.
 */

/** Shared by every generative modality that can produce a batch in one go. */
const COUNT_CHIP: ParamChipSpec = {
  id: 'count',
  icon: 'Layers',
  label: 'Count',
  description:
    'How many results one submission generates. More results cost more.',
  options: [
    { value: '1', label: '1 image' },
    { value: '2', label: '2 images' },
    { value: '4', label: '4 images' },
  ],
  customInput: true,
}

/*
 * Chat has no chips.
 *
 * It carried one, `Advanced settings`, opening a panel of `temperature`,
 * `top_p`, `max_tokens` and `seed` sliders. All four shipped disabled, and an
 * absent field is the correct request for a gateway fronting hundreds of models
 * — so the panel's default state was a control surface that changed nothing,
 * and its non-default state mostly produced upstream rejections (Claude 4+
 * refuses `temperature` and `top_p` together). The chips that remain on the
 * other modalities change *what* gets produced, not how it is sampled.
 */
const CHAT_CAPABILITY: PlaygroundCapability = {
  modality: 'chat',
  canvas: 'conversation',
  async: false,
  endpoint: '/pg/chat/completions',
  upload: { kind: 'attachments', max: 10 },
  params: [],
  billing: { unit: 'token' },
  available: true,
  routed: true,
}

const IMAGE_CAPABILITY: PlaygroundCapability = {
  modality: 'image',
  canvas: 'gallery',
  async: true,
  endpoint: '/pg/images/generations',
  upload: {
    kind: 'reference-slot',
    label: 'Upload reference image',
    max: 4,
  },
  submodes: [
    { id: 'text-to-image', icon: 'Type', label: 'Text to image' },
    { id: 'image-to-image', icon: 'Images', label: 'Image to image' },
    { id: 'inpaint', icon: 'Brush', label: 'Inpaint' },
    { id: 'blend', icon: 'Combine', label: 'Blend' },
  ],
  params: [
    COUNT_CHIP,
    {
      id: 'aspect_ratio',
      icon: 'RectangleHorizontal',
      label: 'Aspect ratio',
      description:
        'Adaptive lets the model frame the shot from your description. With a fixed ratio, some channels drift slightly at the higher resolution tiers.',
      options: [
        { value: 'auto', label: 'Adaptive' },
        { value: '1:1', label: '1:1', hint: 'Square' },
        { value: '3:2', label: '3:2', hint: 'Landscape' },
        { value: '2:3', label: '2:3', hint: 'Portrait' },
        { value: '16:9', label: '16:9', hint: 'Widescreen' },
        { value: '9:16', label: '9:16', hint: 'Vertical' },
      ],
    },
    /*
     * No quality chip, though the parameter is real for some models.
     *
     * `dall-e-3` takes `quality` and is priced by it — `ImageRequest`'s token
     * count meta resolves a size/quality tier for `dall-e` names specifically.
     * But the qwen-image line, which is what this deployment carries, accepts
     * only model/prompt/n/size/image/watermark, so a quality chip in front of
     * those models is a dial connected to nothing.
     *
     * A chip cannot currently say which models it applies to: `params` is flat
     * per modality, so anything listed here is offered for every image model.
     * Re-add quality with that gating and the request-body wiring together —
     * offering it uniformly is wrong in one direction or the other whichever way
     * the majority of models happens to fall.
     */
  ],
  billing: { unit: 'call' },
  // Verified end to end from the browser on 2026-08-29: prompt in, image back,
  // against `qwen-image-2.0` on the aggregator channel.
  //
  // Getting there needed `size` on the request body (`resolveImageSize`), not a
  // flag change. Channels that bill per resolution tier reject a request that
  // omits it, and nothing local surfaces that first — these models are priced per
  // call, so no local code path reads `size` at all.
  available: true,
  routed: true,
}

/**
 * Video differs from every other modality on the backend: it is served by
 * `controller.RelayTask` / `RelayTaskFetch` (the async task pipeline in
 * `router/video-router.go`) rather than `controller.Relay`. Submitting returns a
 * task id that has to be polled, so this endpoint is not interchangeable with
 * the others even though the descriptor shape is.
 */
const VIDEO_CAPABILITY: PlaygroundCapability = {
  modality: 'video',
  canvas: 'video-list',
  async: true,
  endpoint: '/pg/video/generations',
  upload: {
    kind: 'reference-slot',
    label: 'Upload first frame',
    max: 1,
  },
  params: [
    COUNT_CHIP,
    {
      id: 'aspect_ratio',
      icon: 'RectangleHorizontal',
      label: 'Aspect ratio',
      options: [
        { value: '16:9', label: '16:9', hint: 'Landscape' },
        { value: '9:16', label: '9:16', hint: 'Vertical' },
        { value: '1:1', label: '1:1', hint: 'Square' },
      ],
    },
    {
      id: 'resolution',
      icon: 'Monitor',
      label: 'Resolution',
      description: 'Higher resolutions cost more and take longer to generate.',
      options: [
        { value: '720p', label: '720P' },
        { value: '480p', label: '480P' },
      ],
    },
    {
      id: 'duration',
      icon: 'Clock',
      label: 'Length',
      description: 'Billed per second, so length drives the cost directly.',
      options: [
        { value: '3', label: '3 seconds' },
        { value: '6', label: '6 seconds' },
        { value: '10', label: '10 seconds' },
      ],
      customInput: true,
    },
  ],
  billing: { unit: 'second' },
  /**
   * Routed, but not open.
   *
   * `/pg/video/generations` now exists and submits through the task pipeline, so
   * video models are listed and reachable rather than 404ing. What is not
   * established is that any *channel* can serve them: `GetTaskAdaptor` has no
   * case for the aggregator channel types (59/60), so on an aggregator every
   * submission fails at `invalid api platform` before a request goes upstream.
   *
   * A direct channel (Ali, Kling, Vidu, Sora, Gemini, MiniMax…) does have an
   * adaptor and should work. Flip `available` once one has been exercised from
   * the browser — the same bar image had to clear.
   */
  available: false,
  routed: true,
}

const AUDIO_CAPABILITY: PlaygroundCapability = {
  modality: 'audio',
  canvas: 'audio-list',
  async: false,
  endpoint: '/pg/audio/speech',
  upload: { kind: 'voice-picker' },
  params: [
    {
      id: 'speed',
      icon: 'Gauge',
      label: 'Speaking rate',
      options: [
        { value: '0.75', label: '0.75x' },
        { value: '1', label: '1.0x' },
        { value: '1.25', label: '1.25x' },
        { value: '1.5', label: '1.5x' },
      ],
      customInput: true,
    },
    {
      id: 'emotion',
      icon: 'Smile',
      label: 'Emotion',
      options: [
        { value: 'auto', label: 'Auto' },
        { value: 'neutral', label: 'Neutral' },
        { value: 'happy', label: 'Cheerful' },
        { value: 'sad', label: 'Somber' },
      ],
    },
  ],
  billing: {
    unit: 'char',
    note: 'Billed per character; one CJK character counts as roughly two',
  },
  available: false,
  // No `/pg/audio/speech` route. `/v1/audio/speech` exists
  // (`router/relay-router.go:141`) but is token-authenticated and outside the
  // playground group, so the browser cannot reach it as the playground does.
  routed: false,
}

/**
 * The single source of truth mapping a task modality to its surface. Wiring a
 * new modality is a matter of adding an entry here plus its relay route.
 */
export const CAPABILITY_REGISTRY: Record<
  PlaygroundModality,
  PlaygroundCapability
> = {
  chat: CHAT_CAPABILITY,
  image: IMAGE_CAPABILITY,
  video: VIDEO_CAPABILITY,
  audio: AUDIO_CAPABILITY,
}

export function getCapability(
  modality: PlaygroundModality
): PlaygroundCapability {
  return CAPABILITY_REGISTRY[modality]
}
