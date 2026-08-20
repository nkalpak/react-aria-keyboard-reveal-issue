"use client";

// Shared demo for the react-aria keyboard-reveal race. Identical file in the
// Vite repro (src/SheetDemo.jsx) and the Next.js repro (app/SheetDemo.jsx):
// the only variable between the two apps is the bundler/React runtime.
//
// The sheet is a position: fixed bottom sheet whose panel padding grows by the
// keyboard inset derived from --visual-viewport-height (maintained by
// react-aria-components on the ModalOverlay through React state). A form that
// fits at rest only overflows once that inset lands. react-aria's focused-field
// reveal (usePreventScroll) measures synchronously inside the visualViewport
// resize event — whether it sees the inset depends on when the React runtime
// flushes the state update relative to that listener.
//
// The on-screen log shows the verdict directly: the "CALL scrollTo" line is
// react-aria's reveal. top > 0 = it measured settled geometry (revealed);
// top: 0 = it measured stale geometry (field stays below the fold).
import React, { useEffect, useState } from "react";
import {
  Button,
  Dialog,
  DialogTrigger,
  Heading,
  Input,
  Label,
  Modal,
  ModalOverlay,
  TextField,
} from "react-aria-components";

const FIELD_COUNT = 6;

function useEventLog() {
  const [entries, setEntries] = useState([]);

  useEffect(() => {
    const start = performance.now();

    const log = (message) => {
      const t = Math.round(performance.now() - start);
      setEntries((previous) => [...previous.slice(-13), `${t}ms ${message}`]);
    };

    const describe = (element) => {
      if (!(element instanceof Element)) return "document";
      const cls =
        typeof element.className === "string"
          ? element.className.split(" ").slice(0, 2).join(".")
          : "";
      return element.tagName.toLowerCase() + (cls ? `.${cls}` : "");
    };

    // Log every programmatic scroll/focus call, so react-aria's reveal is
    // visible even when it computes a no-op scroll (top: 0).
    const originalScrollTo = Element.prototype.scrollTo;
    Element.prototype.scrollTo = function patchedScrollTo(...args) {
      log(`CALL scrollTo ${describe(this)} ${JSON.stringify(args[0] ?? args)}`);
      return originalScrollTo.apply(this, args);
    };
    const originalFocus = HTMLElement.prototype.focus;
    HTMLElement.prototype.focus = function patchedFocus(...args) {
      log(`CALL focus ${describe(this)} ${JSON.stringify(args[0] ?? {})}`);
      return originalFocus.apply(this, args);
    };

    const scroller = () => document.querySelector(".sheet-body");
    const overflowOf = (node) => (node ? node.scrollHeight - node.clientHeight : "n/a");

    const vv = window.visualViewport;

    const onVvResize = () => {
      log(`vv resize h=${Math.round(vv.height)} sheetOverflow=${overflowOf(scroller())}`);
      // Sample again in a microtask (runs between listeners of this same
      // event) and two frames later — shows when React's commit landed
      // relative to react-aria's reveal listener.
      queueMicrotask(() => log(`  microtask: sheetOverflow=${overflowOf(scroller())}`));
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          const node = scroller();
          log(`  +2 frames: sheetOverflow=${overflowOf(node)} scrollTop=${node ? Math.round(node.scrollTop) : "n/a"}`);
        }),
      );
    };
    const onScroll = (event) => {
      const target = event.target;
      const scrollTop = target instanceof Element ? Math.round(target.scrollTop) : Math.round(window.scrollY);
      log(`scroll ${describe(target)} st=${scrollTop}`);
    };
    const onFocusIn = (event) => log(`focusin ${describe(event.target)}`);

    vv?.addEventListener("resize", onVvResize);
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    document.addEventListener("focusin", onFocusIn, true);

    return () => {
      Element.prototype.scrollTo = originalScrollTo;
      HTMLElement.prototype.focus = originalFocus;
      vv?.removeEventListener("resize", onVvResize);
      document.removeEventListener("scroll", onScroll, { capture: true });
      document.removeEventListener("focusin", onFocusIn, true);
    };
  }, []);

  return entries;
}

export default function SheetDemo({ runtimeLabel }) {
  const [isFixEnabled, setFixEnabled] = useState(false);
  const logEntries = useEventLog();

  // Workaround: mirror --visual-viewport-height onto the overlay
  // synchronously inside the resize event. Registered at mount, so it runs
  // before react-aria's focus-time reveal listener — the reveal then always
  // measures settled geometry, on every React runtime.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!isFixEnabled || !vv) return undefined;

    const onResize = () => {
      document.querySelectorAll(".react-aria-ModalOverlay").forEach((overlay) => {
        overlay.style.setProperty("--visual-viewport-height", `${vv.height}px`);
      });
    };

    vv.addEventListener("resize", onResize);
    return () => vv.removeEventListener("resize", onResize);
  }, [isFixEnabled]);

  return (
    <main className="demo-main">
      <pre className="event-log" aria-hidden>
        {logEntries.join("\n")}
      </pre>
      <h1>{runtimeLabel}</h1>
      <p>
        On iOS Safari: open the sheet, tap <strong>Field {FIELD_COUNT}</strong> directly, let the keyboard settle.
        Watch the <code>CALL scrollTo</code> line in the log: <code>top &gt; 0</code> means react-aria's reveal measured
        the keyboard inset in time and the field scrolls into view; <code>top: 0</code> means it measured before the
        inset landed and the field stays hidden below the fold.
      </p>
      <label className="fix-toggle">
        <input type="checkbox" checked={isFixEnabled} onChange={(event) => setFixEnabled(event.target.checked)} />
        Workaround: write <code>--visual-viewport-height</code> synchronously in the resize event
      </label>
      <DialogTrigger>
        <Button>Open sheet</Button>
        <ModalOverlay>
          <Modal>
            <Dialog>
              <Heading slot="title">Fits at rest</Heading>
              <div className="sheet-body">
                {Array.from({ length: FIELD_COUNT }, (_, index) => (
                  <TextField key={index}>
                    <Label>
                      Field {index + 1} of {FIELD_COUNT}
                    </Label>
                    <Input />
                  </TextField>
                ))}
              </div>
              <div className="sheet-actions">
                <Button slot="close">Save</Button>
              </div>
            </Dialog>
          </Modal>
        </ModalOverlay>
      </DialogTrigger>
    </main>
  );
}
