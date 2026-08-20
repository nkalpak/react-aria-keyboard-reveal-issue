# iOS keyboard reveal fails under React ≥ 19.3: `usePreventScroll` measures before the `--visual-viewport-height` commit

Repro pair for a react-aria / react-aria-components issue. The two apps in
this directory render the same `SheetDemo.jsx` and `demo.css`, copied file
for file. The only variable is the React runtime. The sections below match
the fields of the react-spectrum bug template, so they can be pasted in one
by one.

| App | Runtime | Result on iOS Safari |
| --- | --- | --- |
| `vite-repro/` | Vite + npm React (19.1.4 or 19.2.3, dev or prod build) | works, tapped field is scrolled into view above the keyboard |
| `next-repro/` | Next.js 16.3.0 (vendors a React 19.3 canary; dev and production build, webpack and Turbopack) | broken, tapped field stays hidden behind the keyboard |

Next.js 15.5.23, which vendors an older React, also works. The regression
arrives with the React canary that Next 16 ships, so it will reach every
setup once React stabilizes that change.

Live builds, open either on an iPhone. No install needed:

- Vite (works): <!-- TODO: vercel URL -->
- Next 16 (broken): <!-- TODO: vercel URL -->

---

## Provide a general summary of the issue here

On iOS Safari, tapping a text field inside a Modal that sizes itself from
`--visual-viewport-height` leaves the field hidden behind the keyboard.
Nothing scrolls it into view, and nothing errors.

This has always been a race. React's event priorities used to hide it.

When the keyboard opens, Safari fires one `resize` event on
`visualViewport`, and two listeners run one after the other:

1. `useViewportSize`, added by react-aria-components when the Modal
   mounted. It calls `setState`, which writes `--visual-viewport-height`,
   which grows the sheet's padding and makes the body overflow.
2. `usePreventScroll`'s reveal, added when the user tapped the field. It
   measures the scroller straight away and decides how far to scroll.

So the reveal only works if React commits the first listener's update
before the second listener runs. That comes down to which bucket
`getEventPriority` puts `resize` in.

react-dom 19.2 and earlier group `resize` with `click`. The update flushes
in the microtask between the two listeners, so the reveal measures a
scroller that has already shrunk and overflows. It scrolls correctly.

The React 19.3 canary that Next 16 bundles moves `resize` in with `scroll`
and `mousemove` (facebook/react#35117). The update now flushes after the
whole event finishes. The reveal measures a scroller that has not shrunk
yet, so `scrollHeight - clientHeight` is still 0, the scroll target gets
clamped to 0, and `scrollTo({top: 0})` does nothing.

Underneath, `scrollIntoView` mixes two sources of truth. It reads the
keyboard's position from `visualViewport`, which is correct by then, and
the sheet's size from the DOM, which is not.

Both repros patch `Element.prototype.scrollTo` and log every call, so the
difference shows up as one line:

```text
# vite-repro (React 19.1 / 19.2)
vv resize h=380 sheetOverflow=0
CALL scrollTo div.sheet-body {"top":199,"behavior":"smooth"}
scroll div.sheet-body st=1 ... st=199

# next-repro (React 19.3 canary)
vv resize h=380 sheetOverflow=0
  microtask: sheetOverflow=0
CALL scrollTo div.sheet-body {"top":0,"behavior":"smooth"}
  +2 frames: sheetOverflow=199 scrollTop=0
```

## 🤔 Expected Behavior?

Tapping a field that will end up under the keyboard scrolls it into view
above the keyboard once the keyboard settles, on every React version.

## 😯 Current Behavior

Under React ≥ 19.3, which today means any Next.js 16 app in dev or
production, the tapped field stays hidden behind the keyboard. The reveal
runs, but it measures pre-commit layout: the scroller's
`scrollHeight - clientHeight` is still 0 when `scrollIntoView` clamps its
target, so it scrolls to 0. The user has to scroll by hand, and in a form
that fits without scrolling at rest there is no scrollbar or other hint
that the sheet body scrolls at all. People type into a field they cannot
see.

## 💁 Possible Solution

Measure post-commit geometry instead of measuring inside the `resize`
dispatch. Two options:

- Defer `scrollIntoView` in `scrollIntoViewWhenReady` by a frame or two
  after the `resize` event, or re-run it when the first attempt clamped to
  zero and an ancestor overflows shortly after.
- Or write `--visual-viewport-height` to the DOM directly in the
  `visualViewport` resize listener instead of going through React state,
  so every later listener in the same dispatch sees settled layout.

Both repros include the app-side version of the second option as a
checkbox: a mount-time `visualViewport` resize listener that writes
`--visual-viewport-height` inline on the `.react-aria-ModalOverlay`
element. It registers before the reveal's focus-time listener, so the
reveal always measures settled geometry. It fixes the Next 16 case.

## 🔦 Context

We hit this on a customer-facing passenger-details sheet in a Next.js 16
app. The form fits the sheet at rest, and the keyboard inset derived from
`--visual-viewport-height` is what makes it overflow once the keyboard
opens. That is exactly the geometry where the stale measurement clamps to
zero, so customers tapping the lowest fields typed blind.

It took a while to isolate because every minimal reproduction we built on
Vite passed. The reveal has been relying on `resize` being a discrete
event without anyone noticing, and the trigger is React's scheduling, not
the framework. Next 16 users hit it today; everyone else inherits it when
the reclassification ships in stable React.

## 🖥️ Steps to Reproduce

Open either live build above on an iPhone, or run them locally with
`pnpm install && pnpm dev` (Vite serves on :5199, Next on :3199). Then:

1. Open the sheet via "Open sheet". All 6 fields are visible, nothing
   scrolls at rest.
2. Tap Field 6 directly and let the keyboard settle.
3. Read the `CALL scrollTo` line in the on-screen log. That line is
   react-aria's reveal. On Vite it has `top > 0` and the field scrolls
   into view. On Next 16 it has `top: 0` and Field 6 stays below the
   fold.
4. Optional: enable the "Workaround" checkbox and repeat. The Next 16
   case starts working.

When opening the Next dev server from a phone over the LAN, add your
machine's IP to `allowedDevOrigins` in `next-repro/next.config.mjs`.

## Version

`react-aria-components` 1.17.0 with `@react-aria/overlays` 3.31.1. The
relevant code is unchanged in the latest release; `scrollIntoViewWhenReady`
in 1.20 still measures inside the `resize` dispatch. React: npm 19.1.4 and
19.2.3 work, the React 19.3 canary vendored by Next 16.3.0 fails.

## What browsers are you seeing the problem on?

Safari (iOS). Tested on iOS 18 (device) and iOS 26 (Simulator).

## What operating system are you using?

iOS. Development host macOS.

---

## Running and deploying this repro

Not part of the issue text.

Each app is independent, with its own lockfile and no workspace linking
them, so `pnpm install` inside either directory is enough.

```bash
cd vite-repro && pnpm install && pnpm dev    # http://localhost:5199
cd next-repro && pnpm install && pnpm dev    # http://localhost:3199
```

To reach a dev server from a phone on the same network, both apps already
bind to `0.0.0.0`. For the Next one, also add your machine's LAN IP to
`allowedDevOrigins` in `next-repro/next.config.mjs`, or Next 16 will block
the `/_next/*` requests and the page will render without hydrating.

For the hosted builds, create two Vercel projects from this one repository
and set the root directory of each:

| Vercel project | Root directory | Framework detected |
| --- | --- | --- |
| the working one | `vite-repro` | Vite, output `dist` |
| the broken one | `next-repro` | Next.js |

Nothing else to configure. The Next app's only route prerenders as static,
so Vercel serves it as static files, and the bug still reproduces because
it lives in the client bundle. Confirmed against
`.next/static/chunks`, which contains React
`19.3.0-canary-cbb046ab-20260731` with `resize` grouped alongside `scroll`.
