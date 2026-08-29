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
 * Content for the main-area empty state: what the selected model is for, what
 * it is good at, where it bites, and prompts that demonstrate it.
 *
 * Keyed by modality with optional per-model overrides. Writing one entry per
 * model does not scale — a deployment carries hundreds — so the modality entry
 * is the contract and an override only exists where a specific model genuinely
 * behaves differently.
 *
 * Every string is an English source string used as an i18next key, matching the
 * rest of the project; this module holds no React context, so the panel resolves
 * them through `t()`.
 */
import type { PlaygroundModality } from './types'

export type ModelGuideExample = {
  /** Lucide icon name, resolved by the rendering component. */
  icon: string
  label: string
  /** Text dropped into the composer when the example is clicked. */
  prompt: string
}

export type ModelGuide = {
  /** One-line positioning, rendered under the model name. */
  tagline: string
  /** What the model is worth reaching for. */
  strengths: string[]
  /** Known limits. This is the part users cannot get from a model card. */
  caveats?: string[]
  examples: ModelGuideExample[]
}

const CHAT_GUIDE: ModelGuide = {
  tagline: 'Conversational model for text reasoning, writing and code.',
  strengths: [
    'Long-form reasoning and step-by-step analysis',
    'Writing, rewriting and summarising documents',
    'Reading code, explaining it and proposing fixes',
    'Structured extraction into JSON or tables',
  ],
  caveats: [
    'Facts and figures can be fabricated with total confidence — verify anything that matters.',
    'Only the recent turns of a conversation stay in view; very long histories get truncated.',
  ],
  examples: [
    {
      icon: 'BarChart',
      label: 'Analyze data',
      prompt:
        'Here is a table of monthly revenue. Identify the trend, call out anomalies, and tell me what to investigate first.',
    },
    {
      icon: 'NotepadText',
      label: 'Summarize text',
      prompt:
        'Summarise the following text into five bullet points, keeping every number and date intact.',
    },
    {
      icon: 'CodeSquare',
      label: 'Review code',
      prompt:
        'Review this function for correctness and edge cases. Point out real defects only, and show the fix.',
    },
    {
      icon: 'GraduationCap',
      label: 'Explain a concept',
      prompt:
        'Explain how database transaction isolation levels differ, with a concrete example of a bug each one prevents.',
    },
  ],
}

const IMAGE_GUIDE: ModelGuide = {
  tagline: 'Generates images from a text description or a reference image.',
  strengths: [
    'Illustration, concept art and stylised composition',
    'Product and marketing imagery from a written brief',
    'Editing part of an existing image while keeping the rest',
    'Reworking one reference image into several variants',
  ],
  caveats: [
    'Text inside an image is unreliable — expect misspelled words on signs and packaging.',
    'Hands, faces and repeated small objects are where artefacts show up first.',
    'The same prompt does not reproduce the same image; pin the seed when you need consistency.',
  ],
  examples: [
    {
      icon: 'Sparkles',
      label: 'Product shot',
      prompt:
        'A ceramic pour-over coffee set on a walnut table, soft window light from the left, shallow depth of field, editorial product photography.',
    },
    {
      icon: 'Brush',
      label: 'Illustration',
      prompt:
        'A quiet mountain village at dusk, flat vector illustration, limited palette of five colours, subtle paper grain.',
    },
    {
      icon: 'Type',
      label: 'Poster layout',
      prompt:
        'A minimal conference poster: bold geometric shapes, generous whitespace, space reserved at the top for a title.',
    },
    {
      icon: 'Images',
      label: 'Style variant',
      prompt:
        'Take the reference image and render it as a watercolour study, keeping the composition and lighting direction.',
    },
  ],
}

const VIDEO_GUIDE: ModelGuide = {
  tagline: 'Generates short video clips from text or a first frame.',
  strengths: [
    'Short B-roll and atmospheric establishing shots',
    'Animating a still image into a moving clip',
    'Product motion loops for landing pages',
  ],
  caveats: [
    'Clips run a few seconds; anything longer has to be assembled from several generations.',
    'Object permanence is weak — details drift or morph across frames.',
    'Generation is queued and takes minutes, and is billed per second of output.',
  ],
  examples: [
    {
      icon: 'Clock',
      label: 'Establishing shot',
      prompt:
        'Slow drone push over a coastal cliff at sunrise, low mist over the water, gentle camera drift, 6 seconds.',
    },
    {
      icon: 'Monitor',
      label: 'Product loop',
      prompt:
        'A wireless earbud case rotating slowly on a matte surface, soft studio lighting, seamless loop.',
    },
    {
      icon: 'Images',
      label: 'Animate a still',
      prompt:
        'Animate the uploaded first frame with a subtle parallax push-in and drifting clouds, keeping the subject still.',
    },
  ],
}

const AUDIO_GUIDE: ModelGuide = {
  tagline: 'Turns text into spoken audio in a selectable voice.',
  strengths: [
    'Voiceover for demos, courses and explainer videos',
    'Audio versions of articles and documentation',
    'Prompts and alerts for IVR and embedded devices',
  ],
  caveats: [
    'Rare names, acronyms and technical terms are often mispronounced — spell them phonetically.',
    'Punctuation is what controls pacing; long unpunctuated sentences run together.',
    'Billed per character, so Chinese text costs roughly twice its character count.',
  ],
  examples: [
    {
      icon: 'Gauge',
      label: 'Product voiceover',
      prompt:
        'Welcome to the console. In this short tour, we will connect your first channel and send a test request.',
    },
    {
      icon: 'NotepadText',
      label: 'Read an article',
      prompt:
        'Read the following paragraph in a calm, measured narration suitable for a documentation walkthrough.',
    },
    {
      icon: 'Smile',
      label: 'Announcement',
      prompt:
        'Your order has been shipped and will arrive within two business days. Thank you for shopping with us.',
    },
  ],
}

const MODALITY_GUIDES: Record<PlaygroundModality, ModelGuide> = {
  chat: CHAT_GUIDE,
  image: IMAGE_GUIDE,
  video: VIDEO_GUIDE,
  audio: AUDIO_GUIDE,
}

/**
 * Per-model overrides, keyed by model name.
 *
 * Empty on purpose: every model shipping today is described well enough by its
 * modality entry. Add one only when a model genuinely diverges — different
 * strengths, or a caveat that would otherwise surprise someone — and note why.
 */
export const MODEL_GUIDE_OVERRIDES: Record<string, Partial<ModelGuide>> = {}

/**
 * Refines a modality guide with a model-specific override.
 *
 * Replacement is per field rather than deep: an override that lists `caveats`
 * means "these caveats instead of the modality's", not "these as well". Merging
 * the arrays would silently mix a general warning into a model that does not
 * have that problem.
 */
export function refineGuide(
  base: ModelGuide,
  override: Partial<ModelGuide> | undefined
): ModelGuide {
  if (!override) return base

  return { ...base, ...override }
}

/**
 * Resolves the guide for a model. Falls back to the modality entry when no
 * override exists, and returns `undefined` for models whose modality could not
 * be derived — the caller keeps its generic empty state for that case.
 */
export function getModelGuide(
  modality: PlaygroundModality | undefined,
  modelName?: string
): ModelGuide | undefined {
  if (!modality) return undefined

  return refineGuide(
    MODALITY_GUIDES[modality],
    modelName ? MODEL_GUIDE_OVERRIDES[modelName] : undefined
  )
}
