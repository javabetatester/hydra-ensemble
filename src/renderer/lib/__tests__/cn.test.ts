import { describe, expect, it } from 'vitest'
import { cn } from '../cn'

describe('cn', () => {
  it('joins plain string arguments with a single space', () => {
    expect(cn('px-2', 'py-1', 'text-sm')).toBe('px-2 py-1 text-sm')
  })

  it('skips falsy scalars (false, null, undefined, empty string)', () => {
    expect(cn('a', false, null, undefined, '', 'b')).toBe('a b')
  })

  it('includes numeric values and skips NaN', () => {
    expect(cn('grid', 0, 1, NaN, 'end')).toBe('grid 0 1 end')
  })

  it('flattens deeply nested arrays', () => {
    expect(cn(['a', ['b', ['c', ['d']]], 'e'])).toBe('a b c d e')
  })

  it('includes object keys only when their value is truthy', () => {
    expect(cn('base', { active: true, disabled: false, hidden: 0, shown: 1 })).toBe(
      'base active shown',
    )
  })

  it('deduplicates repeated classes coming from different sources', () => {
    expect(cn('px-2 px-2', ['px-2'], { 'px-2': true })).toBe('px-2')
  })

  it('collapses extra whitespace inside a single string argument', () => {
    expect(cn('  px-2   py-1  ', '\n\ttext-sm ')).toBe('px-2 py-1 text-sm')
  })

  it('returns an empty string when given no truthy input', () => {
    expect(cn()).toBe('')
    expect(cn(false, null, undefined, '', [], {})).toBe('')
  })

  it('combines strings, arrays, objects, and numbers in one call', () => {
    const isActive = true
    const isDisabled = false
    expect(
      cn(
        'btn',
        ['rounded', 'px-3'],
        { active: isActive, disabled: isDisabled },
        isActive && 'ring-2',
        42,
      ),
    ).toBe('btn rounded px-3 active ring-2 42')
  })

  it('keeps the first occurrence order when deduplicating', () => {
    expect(cn('a b c', 'b a d', ['c', 'e'])).toBe('a b c d e')
  })
})
