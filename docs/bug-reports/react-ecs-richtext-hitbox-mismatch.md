# Bug: `<Label>` rich-text markup causes hitbox / paint-box mismatch on auto-sized parents

**Reporter:** Snow Drift team
**Platform:** Decentraland mobile client (SDK 7, react-ecs UI)
**SDK version:** `@dcl/sdk@7.26.1-31714079767.commit-96e9a29`
**Severity:** High — silently breaks tap input on any UI that uses this common pattern.

---

## Summary

When a `<Label>` uses rich-text markup (e.g. `<b>...</b>`) as its `value`, its
reported intrinsic width is measured from the **plain text** (markup stripped),
but the glyphs are **painted with the bold/styled width**. If that `<Label>`
lives inside a parent `UiEntity` with `uiTransform.width: 'auto'` and the
parent is the tap target (has `onMouseDown` / `onMouseUp`), the parent's
**layout / hitbox rectangle** ends up narrower than its **painted background /
border rectangle**.

Result: the user sees a large coloured button, taps on the visibly-highlighted
outer edge, and nothing happens. Only taps that happen to land inside the
smaller inner rectangle register. In practice this feels like "the button
needs 5–10 taps to fire".

## Reproduction

Minimal repro:

```tsx
<UiEntity
    uiTransform  = {{
        width        : 'auto',
        height       : 112,
        padding      : { left: 20, right: 20 },
        flexDirection: 'row',
        alignItems   : 'center',
    }}
    uiBackground = {{ color: Color4.create(1.00, 0.80, 0.30, 1) }}   // solid gold
    onMouseDown  = {() => console.log('tapped')}
>
    <Label
        value       = "<b>LIGHT TORCH</b>"
        fontSize    = {32}
        font        = "sans-serif"
        textAlign   = "middle-left"
        uiTransform = {{ width: 'auto', height: 52 }}
    />
</UiEntity>
```

1. Render on mobile client at real device DPI.
2. Tap the **right-hand ~25%** of the visibly-gold rectangle repeatedly — nothing fires.
3. Tap the **left-hand ~75%** — fires reliably.
4. Remove the `<b>...</b>` wrapping (value becomes `"LIGHT TORCH"`).
5. Entire visible gold rectangle is now tappable first-time, every time.

The mismatch scales with how much wider the bold glyphs are than the plain
glyphs — the wider the styled text, the larger the "dead zone" on the outer
edge of the parent.

## Expected behaviour

The parent's layout rectangle (used for hit-testing) should be measured from
the same glyph metrics used to paint the label. `<Label>` should report a
measured width consistent with what it will actually paint, so that
`width: 'auto'` parents wrap the paint area, not the plain-text area.

## Actual behaviour

Parent hitbox tracks the plain-text measurement; background / border tracks
the styled-glyph paint. The two disagree by the delta between plain and bold
widths (roughly 8–15% for the default sans-serif at large sizes).

## Impact

This is a *silent* input regression — nothing throws, nothing logs, the UI
still visually appears correct. It bites any pattern of:

- An auto-sized tap target
- Containing a `<Label>` with any rich-text markup

Which is a very common pattern (button labels, tooltips, chips, badges). In
our scene it broke the two most-used mobile controls (Light Torch / Feed
Fire tooltips) and cost several rounds of misdirected debugging before the
markup was suspected.

## Workarounds

Both work, neither is discoverable:

1. **Drop the markup.** Pass plain strings as `Label.value`. Use `fontSize`
   for emphasis instead of `<b>`. (This is what we shipped.)
2. **Give the parent an explicit `width`.** Locks the hitbox to a known
   rectangle so it can't drift from the paint box, regardless of what the
   label reports.

Neither workaround is signposted in the SDK docs, and both require the
developer to already suspect the measurement/paint mismatch.

## Suggested fix

Have `<Label>` measure its intrinsic size with the same rich-text parser
that paints it, so bold / italic / coloured glyphs contribute their actual
rendered widths to the reported layout size. Alternatively, document the
mismatch prominently in the `<Label>` API reference and recommend explicit
widths on tap-target parents that host rich-text labels.

## Files in our codebase where this bit us

- `src/client/ui/layers/layer.relightPrompt.tsx`
- `src/client/ui/layers/layer.feedPrompt.tsx`

Both now use plain-string values on mobile with a comment pointing at this
report.
