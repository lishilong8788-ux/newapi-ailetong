import { describe, expect, it } from 'vitest'

import { deriveModality, isPlaygroundModel } from '../derive'
import { CAPABILITY_REGISTRY, getCapability } from '../registry'

describe('deriveModality', () => {
  it('collapses every conversational wire format to chat', () => {
    for (const endpoint of [
      'openai',
      'openai-response',
      'openai-response-compact',
      'openai-alpha-search',
      'anthropic',
      'gemini',
    ]) {
      expect(deriveModality([endpoint])).toBe('chat')
    }
  })

  it('maps generative endpoints to their modality', () => {
    expect(deriveModality(['image-generation'])).toBe('image')
    expect(deriveModality(['openai-video'])).toBe('video')
  })

  it('classifies speech models by tag, since no audio endpoint type exists', () => {
    expect(deriveModality(['openai'], 'audio')).toBe('audio')
    expect(deriveModality(['openai'], 'hot, audio, new')).toBe('audio')
  })

  it('matches tags case-insensitively and ignores padding', () => {
    expect(deriveModality(['openai'], '  AUDIO ')).toBe('audio')
  })

  it('excludes models with no interactive surface', () => {
    expect(deriveModality(['embeddings'])).toBeNull()
    expect(deriveModality(['jina-rerank'])).toBeNull()
    expect(isPlaygroundModel(['embeddings'])).toBe(false)
  })

  it('excludes speech-to-text, which is not the audio modality here', () => {
    // The audio capability is synthesis (text in, player out). An ASR model
    // runs the other way and has no surface, so it must not be mistaken for
    // an audio model — nor fall through to chat.
    expect(deriveModality(['audio-transcription'])).toBeNull()
    expect(isPlaygroundModel(['audio-transcription'])).toBe(false)
  })

  it('falls back to chat when endpoint metadata is absent', () => {
    // Deployments predating endpoint metadata would otherwise show an empty
    // library, which is worse than assuming the common case.
    expect(deriveModality(undefined)).toBe('chat')
    expect(deriveModality([])).toBe('chat')
  })

  it('does not guess for endpoints it has never heard of', () => {
    expect(deriveModality(['some-future-endpoint'])).toBeNull()
  })

  it('prefers image over chat when a model reports both', () => {
    expect(deriveModality(['openai', 'image-generation'])).toBe('image')
  })
})

describe('capability registry', () => {
  it('covers every modality deriveModality can return', () => {
    expect(Object.keys(CAPABILITY_REGISTRY).sort()).toEqual([
      'audio',
      'chat',
      'image',
      'video',
    ])
  })

  it('opens the modalities verified from the browser, and no others', () => {
    expect(getCapability('chat').available).toBe(true)
    expect(getCapability('image').available).toBe(true)
    expect(getCapability('video').available).toBe(false)
    expect(getCapability('audio').available).toBe(false)
  })

  // `routed` is what the library filters on, so an unrouted modality can never be
  // open — that would list a model whose submit path 404s.
  it('never marks a modality available without a route to reach it', () => {
    for (const [modality, capability] of Object.entries(CAPABILITY_REGISTRY)) {
      if (capability.available) {
        expect(capability.routed, modality).toBe(true)
      }
    }
  })

  it('routes chat at the endpoint the playground already ships', () => {
    expect(getCapability('chat').endpoint).toBe('/pg/chat/completions')
  })

  it('marks long-running modalities async so the header can offer a task list', () => {
    expect(getCapability('chat').async).toBe(false)
    expect(getCapability('image').async).toBe(true)
    expect(getCapability('video').async).toBe(true)
  })

  // Guards the removal documented in `registry.ts`: the backend exposes no
  // routing strategy, so a chip offering one would be a promise the product
  // cannot keep. Re-add it only alongside the field that carries it.
  it('offers no channel-routing chip, since the backend has no such dial', () => {
    for (const capability of Object.values(CAPABILITY_REGISTRY)) {
      expect(capability.params.map((param) => param.id)).not.toContain(
        'channel'
      )
    }
  })

  it('quotes each modality in the unit its upstream bills in', () => {
    expect(getCapability('chat').billing.unit).toBe('token')
    expect(getCapability('image').billing.unit).toBe('call')
    expect(getCapability('video').billing.unit).toBe('second')
    expect(getCapability('audio').billing.unit).toBe('char')
  })

  it('keeps parameter ids unique within a modality', () => {
    for (const capability of Object.values(CAPABILITY_REGISTRY)) {
      const ids = capability.params.map((param) => param.id)
      expect(new Set(ids).size).toBe(ids.length)
    }
  })
})
