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

/**
 * Channel routing is modality-independent: every model is dispatched through
 * the same upstream pool, so this chip is shared verbatim.
 */
const CHANNEL_CHIP: ParamChipSpec = {
  id: 'channel',
  icon: 'Route',
  label: '渠道',
  description:
    '综合价格、成功率、速度与实时拥堵情况智能分流，自动避开拥堵渠道。也可指定单一渠道。',
  options: [
    { value: 'balanced', label: '综合最优', hint: '价格、速度与成功率均衡' },
    { value: 'price', label: '价格优先', hint: '优先选择单价最低的可用渠道' },
    { value: 'speed', label: '速度优先', hint: '优先选择平均耗时最短的渠道' },
    { value: 'success', label: '成功率优先', hint: '优先选择成功率最高的渠道' },
  ],
}

/** Shared by every generative modality that can produce a batch in one go. */
const COUNT_CHIP: ParamChipSpec = {
  id: 'count',
  icon: 'Layers',
  label: '生成数量',
  description: '单次提交生成的结果数量，数量越多消耗越高。',
  options: [
    { value: '1', label: '1 张' },
    { value: '2', label: '2 张' },
    { value: '4', label: '4 张' },
  ],
  customInput: true,
}

const CHAT_CAPABILITY: PlaygroundCapability = {
  modality: 'chat',
  canvas: 'conversation',
  async: false,
  endpoint: '/pg/chat/completions',
  upload: { kind: 'attachments', max: 10 },
  params: [
    CHANNEL_CHIP,
    {
      id: 'advanced',
      icon: 'SlidersHorizontal',
      label: '高级设置',
      description:
        '采样与长度相关参数。未启用的参数不会写入请求，由上游使用默认值。',
    },
  ],
  billing: { unit: 'token' },
  available: true,
}

const IMAGE_CAPABILITY: PlaygroundCapability = {
  modality: 'image',
  canvas: 'gallery',
  async: true,
  endpoint: '/pg/images/generations',
  upload: {
    kind: 'reference-slot',
    label: '上传参考图',
    max: 4,
  },
  submodes: [
    { id: 'text-to-image', icon: 'Type', label: '文生图' },
    { id: 'image-to-image', icon: 'Images', label: '图生图' },
    { id: 'inpaint', icon: 'Brush', label: '局部编辑' },
    { id: 'blend', icon: 'Combine', label: '多图融合' },
  ],
  params: [
    CHANNEL_CHIP,
    COUNT_CHIP,
    {
      id: 'aspect_ratio',
      icon: 'RectangleHorizontal',
      label: '图片比例',
      description:
        '自适应会由模型根据描述自行判断构图。选择固定比例时，部分渠道在高分辨率档位下比例可能存在偏差。',
      options: [
        { value: 'auto', label: '自适应' },
        { value: '1:1', label: '1:1', hint: '方形' },
        { value: '3:2', label: '3:2', hint: '横向' },
        { value: '2:3', label: '2:3', hint: '纵向' },
        { value: '16:9', label: '16:9', hint: '宽屏' },
        { value: '9:16', label: '9:16', hint: '竖屏' },
      ],
    },
    {
      id: 'quality',
      icon: 'Sparkles',
      label: '图片质量',
      description: '质量越高，生成耗时与消耗越高。自动会按描述复杂度选择档位。',
      options: [
        { value: 'auto', label: '自动' },
        { value: 'high', label: '高' },
        { value: 'medium', label: '中' },
        { value: 'low', label: '低' },
      ],
    },
  ],
  billing: { unit: 'call' },
  available: false,
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
    label: '上传首帧图',
    max: 1,
  },
  params: [
    CHANNEL_CHIP,
    COUNT_CHIP,
    {
      id: 'aspect_ratio',
      icon: 'RectangleHorizontal',
      label: '宽高比',
      options: [
        { value: '16:9', label: '16:9', hint: '横屏' },
        { value: '9:16', label: '9:16', hint: '竖屏' },
        { value: '1:1', label: '1:1', hint: '方形' },
      ],
    },
    {
      id: 'resolution',
      icon: 'Monitor',
      label: '画质',
      description: '分辨率越高消耗越高，生成时间也更长。',
      options: [
        { value: '720p', label: '720P' },
        { value: '480p', label: '480P' },
      ],
    },
    {
      id: 'duration',
      icon: 'Clock',
      label: '时长',
      description: '按秒计费，时长直接决定消耗。',
      options: [
        { value: '3', label: '3 秒' },
        { value: '6', label: '6 秒' },
        { value: '10', label: '10 秒' },
      ],
      customInput: true,
    },
  ],
  billing: { unit: 'second' },
  available: false,
}

const AUDIO_CAPABILITY: PlaygroundCapability = {
  modality: 'audio',
  canvas: 'audio-list',
  async: false,
  endpoint: '/pg/audio/speech',
  upload: { kind: 'voice-picker' },
  params: [
    CHANNEL_CHIP,
    {
      id: 'speed',
      icon: 'Gauge',
      label: '语速',
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
      label: '情绪',
      options: [
        { value: 'auto', label: '自动' },
        { value: 'neutral', label: '中性' },
        { value: 'happy', label: '愉快' },
        { value: 'sad', label: '低沉' },
      ],
    },
  ],
  billing: {
    unit: 'char',
    note: '按字符计费，1 个汉字约等于 2 字符',
  },
  available: false,
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
