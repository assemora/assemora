/**
 * Every step the form screen takes, on the registry's own shape. What matters in each
 * is what it does *not* lose: a field, a section, a tab's contents.
 */
import { describe, expect, it } from 'vitest'

import type { Layout } from '../api/introspection.ts'
import {
  addSection,
  addTab,
  moveField,
  moveSection,
  moveTab,
  placedNames,
  placeField,
  removeSection,
  removeTab,
  retitleSection,
  setCondition,
  setWidth,
  startingLayout,
  uniqueKey,
  unplaceField,
  withTabs,
} from './edit.ts'

const PAGE: Layout = {
  sections: [
    { key: 'head', title: 'Head', fields: ['title', 'slug'] },
    { key: 'text', fields: ['body'] },
  ],
  aside: [{ key: 'flags', fields: ['featured'] }],
}

describe('tabs', () => {
  it('turns one page into one tab holding every section, and back without losing one', () => {
    const tabbed = withTabs(PAGE, true, 'General')

    expect(tabbed.tabs?.map((tab) => tab.sections.map((section) => section.key))).toEqual([
      ['head', 'text'],
    ])
    expect(tabbed.aside).toEqual(PAGE.aside)
    expect(withTabs(tabbed, false, '')).toEqual(PAGE)
  })

  it('adds a tab with a key nothing else uses, and moves it', () => {
    const two = addTab(withTabs(PAGE, true, 'General'), 'SEO')

    expect(two.tabs?.map((tab) => tab.key)).toEqual(['tab', 'tab-2'])
    expect(moveTab(two, 'tab-2', -1).tabs?.map((tab) => tab.key)).toEqual(['tab-2', 'tab'])
  })

  it('removing a tab hands its sections to the one before it, and never removes the last', () => {
    let two = addTab(withTabs(PAGE, true, 'General'), 'SEO')

    two = addSection(two, { tab: 'tab-2' })
    two = placeField(two, 'slug', 'section')

    const one = removeTab(two, 'tab-2')

    expect(one.tabs?.length).toBe(1)
    expect(one.tabs?.[0]?.sections.map((section) => section.key)).toEqual([
      'head',
      'text',
      'section',
    ])
    expect(placedNames(one)).toEqual(['title', 'body', 'slug', 'featured'])
    expect(removeTab(one, 'tab')).toEqual(one)
  })
})

describe('sections', () => {
  it('adds beside the form, on the page, or in a named tab', () => {
    expect(addSection(PAGE, { aside: true }).aside?.map((section) => section.key)).toEqual([
      'flags',
      'section',
    ])
    expect(addSection(PAGE, {}).sections?.map((section) => section.key)).toEqual([
      'head',
      'text',
      'section',
    ])
  })

  it('removing a section unplaces its fields rather than losing them', () => {
    const without = removeSection(PAGE, 'head')

    expect(placedNames(without)).toEqual(['body', 'featured'])
  })

  it('sets when a section is shown, and takes the condition off again', () => {
    const shown = setCondition(PAGE, 'text', { field: 'featured', equals: true })

    expect(shown.sections?.[1]?.visibleWhen).toEqual({ field: 'featured', equals: true })
    expect(setCondition(shown, 'text', undefined).sections?.[1]).not.toHaveProperty('visibleWhen')
  })

  it('moves a section within its list, retitles it, and drops an empty title', () => {
    expect(moveSection(PAGE, 'text', -1).sections?.map((section) => section.key)).toEqual([
      'text',
      'head',
    ])
    expect(retitleSection(PAGE, 'head', 'Identity').sections?.[0]?.title).toBe('Identity')
    expect(retitleSection(PAGE, 'head', '  ').sections?.[0]).not.toHaveProperty('title')
  })
})

describe('fields', () => {
  it('places a field in a section, taking it out of wherever it was', () => {
    const moved = placeField(PAGE, 'featured', 'head')

    expect(moved.sections?.[0]?.fields).toEqual(['title', 'slug', 'featured'])
    expect(moved.aside?.[0]?.fields).toEqual([])
  })

  it('unplaces, moves within a section, and sets a width as the compact form when full', () => {
    expect(placedNames(unplaceField(PAGE, 'slug'))).toEqual(['title', 'body', 'featured'])
    expect(moveField(PAGE, 'slug', -1).sections?.[0]?.fields).toEqual(['slug', 'title'])
    expect(setWidth(PAGE, 'slug', 'half').sections?.[0]?.fields).toEqual([
      'title',
      { field: 'slug', width: 'half' },
    ])
    expect(setWidth(setWidth(PAGE, 'slug', 'half'), 'slug', 'full').sections?.[0]?.fields).toEqual([
      'title',
      'slug',
    ])
  })

  it('starts from one section holding every field, with a key nothing collides with', () => {
    const started = startingLayout(['title', 'body'])

    expect(started).toEqual({ sections: [{ key: 'main', fields: ['title', 'body'] }] })
    expect(uniqueKey(started, 'main')).toBe('main-2')
  })
})
