/**
 * Seeds annotator — a small marker.js-style image annotator built on Fabric.js (MIT).
 * Tools: select/move, rectangle, arrow, text, pen, colour, undo, clear.
 * Exposes window.SeedsAnnotator.exportPng() → data URL (flattened image + annotations) or null.
 *
 * Requires Fabric.js loaded before this file.
 */
(function () {
  const COLORS = ["#e5484d", "#f5b301", "#1f6f68", "#111111", "#ffffff"];
  const MAX_CANVAS_W = 560;
  const MAX_EXPORT_W = 1600;

  let canvas = null;
  let mode = "select";
  let color = COLORS[0];
  let drawScale = 1;          // display px per source px
  const undoStack = [];
  let drag = null;            // { startX, startY, obj }

  const els = {};

  function q(id) { return document.getElementById(id); }

  function ready() {
    els.section = q("shotSection");
    els.drop = q("shotDrop");
    els.file = q("shotFile");
    els.editor = q("shotEditor");
    els.canvasEl = q("shotCanvas");
    els.toolbar = q("shotToolbar");
    els.swatches = q("shotSwatches");
    if (!els.drop) return;

    els.drop.addEventListener("click", () => els.file.click());
    els.file.addEventListener("change", (e) => {
      if (e.target.files && e.target.files[0]) loadFile(e.target.files[0]);
    });
    els.drop.addEventListener("dragover", (e) => { e.preventDefault(); els.drop.classList.add("hover"); });
    els.drop.addEventListener("dragleave", () => els.drop.classList.remove("hover"));
    els.drop.addEventListener("drop", (e) => {
      e.preventDefault(); els.drop.classList.remove("hover");
      const f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) loadFile(f);
    });
    // Paste a screenshot anywhere on the page
    document.addEventListener("paste", (e) => {
      const items = e.clipboardData && e.clipboardData.items;
      if (!items) return;
      for (const it of items) {
        if (it.type && it.type.indexOf("image") === 0) { loadFile(it.getAsFile()); break; }
      }
    });

    buildToolbar();
  }

  function loadFile(file) {
    if (!file || file.type.indexOf("image") !== 0) return;
    const reader = new FileReader();
    reader.onload = (ev) => initEditor(ev.target.result);
    reader.readAsDataURL(file);
  }

  function initEditor(dataUrl) {
    fabric.Image.fromURL(dataUrl, (img) => {
      const wrapW = (els.editor.clientWidth || MAX_CANVAS_W) - 2;
      drawScale = Math.min(1, Math.min(MAX_CANVAS_W, wrapW) / img.width);
      const w = Math.round(img.width * drawScale);
      const h = Math.round(img.height * drawScale);

      if (canvas) { canvas.dispose(); }
      canvas = new fabric.Canvas(els.canvasEl, { width: w, height: h, selection: true });
      img.set({ selectable: false, evented: false });
      img.scaleToWidth(w);
      canvas.setBackgroundImage(img, canvas.renderAll.bind(canvas));

      undoStack.length = 0;
      wireCanvas();
      setMode("rect");
      els.drop.style.display = "none";
      els.editor.classList.add("on");
    });
  }

  function buildToolbar() {
    const tools = [
      ["select", "Move"],
      ["rect", "Box"],
      ["arrow", "Arrow"],
      ["text", "Text"],
      ["pen", "Pen"],
    ];
    els.toolbar.innerHTML = "";
    tools.forEach(([m, label]) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "tool"; b.dataset.mode = m; b.textContent = label;
      b.addEventListener("click", () => setMode(m));
      els.toolbar.appendChild(b);
    });
    const sep = document.createElement("span"); sep.className = "sep"; els.toolbar.appendChild(sep);

    const undo = document.createElement("button");
    undo.type = "button"; undo.className = "tool"; undo.textContent = "Undo";
    undo.addEventListener("click", doUndo); els.toolbar.appendChild(undo);

    const clear = document.createElement("button");
    clear.type = "button"; clear.className = "tool"; clear.textContent = "Clear";
    clear.addEventListener("click", doClear); els.toolbar.appendChild(clear);

    const remove = document.createElement("button");
    remove.type = "button"; remove.className = "tool"; remove.textContent = "Remove image";
    remove.addEventListener("click", removeImage); els.toolbar.appendChild(remove);

    els.swatches.innerHTML = "";
    COLORS.forEach((c) => {
      const s = document.createElement("button");
      s.type = "button"; s.className = "swatch" + (c === color ? " on" : "");
      s.style.background = c; s.dataset.color = c;
      s.addEventListener("click", () => setColor(c));
      els.swatches.appendChild(s);
    });
  }

  function setColor(c) {
    color = c;
    [...els.swatches.children].forEach((s) => s.classList.toggle("on", s.dataset.color === c));
    if (canvas && canvas.freeDrawingBrush) canvas.freeDrawingBrush.color = c;
    const o = canvas && canvas.getActiveObject();
    if (o) {
      if (o.type === "i-text") o.set("fill", c);
      else if (o.type === "group") o.getObjects().forEach((p) => p.set(p.type === "triangle" ? "fill" : "stroke", c));
      else if (o.stroke) o.set("stroke", c);
      canvas.requestRenderAll();
    }
  }

  function setMode(m) {
    mode = m;
    [...els.toolbar.querySelectorAll(".tool")].forEach((b) => b.classList.toggle("on", b.dataset.mode === m));
    if (!canvas) return;
    canvas.isDrawingMode = (m === "pen");
    if (m === "pen") {
      canvas.freeDrawingBrush = new fabric.PencilBrush(canvas);
      canvas.freeDrawingBrush.color = color;
      canvas.freeDrawingBrush.width = 3;
    }
    const selectable = (m === "select");
    canvas.selection = selectable;
    canvas.forEachObject((o) => { o.selectable = selectable; o.evented = selectable; });
    canvas.defaultCursor = selectable ? "default" : "crosshair";
    canvas.requestRenderAll();
  }

  function wireCanvas() {
    canvas.on("path:created", (e) => { push(e.path); });

    canvas.on("mouse:down", (opt) => {
      if (mode === "select" || mode === "pen") return;
      const p = canvas.getPointer(opt.e);
      drag = { startX: p.x, startY: p.y, obj: null };

      if (mode === "text") {
        const t = new fabric.IText("Text", {
          left: p.x, top: p.y, fontSize: 20, fill: color, fontFamily: "Segoe UI, sans-serif",
        });
        canvas.add(t); push(t); canvas.setActiveObject(t); t.enterEditing(); t.selectAll();
        drag = null;
        return;
      }
      if (mode === "rect") {
        drag.obj = new fabric.Rect({
          left: p.x, top: p.y, width: 1, height: 1, fill: "transparent",
          stroke: color, strokeWidth: 3, rx: 2, ry: 2, selectable: false, evented: false,
        });
        canvas.add(drag.obj);
      }
      if (mode === "arrow") {
        drag.obj = new fabric.Line([p.x, p.y, p.x, p.y], {
          stroke: color, strokeWidth: 3, selectable: false, evented: false,
        });
        canvas.add(drag.obj);
      }
    });

    canvas.on("mouse:move", (opt) => {
      if (!drag || !drag.obj) return;
      const p = canvas.getPointer(opt.e);
      if (mode === "rect") {
        drag.obj.set({
          width: Math.abs(p.x - drag.startX),
          height: Math.abs(p.y - drag.startY),
          left: Math.min(p.x, drag.startX),
          top: Math.min(p.y, drag.startY),
        });
      } else if (mode === "arrow") {
        drag.obj.set({ x2: p.x, y2: p.y });
      }
      canvas.requestRenderAll();
    });

    canvas.on("mouse:up", (opt) => {
      if (!drag) return;
      const p = canvas.getPointer(opt.e);
      if (mode === "arrow" && drag.obj) {
        canvas.remove(drag.obj);
        const g = makeArrow(drag.startX, drag.startY, p.x, p.y, color);
        if (g) { canvas.add(g); push(g); }
      } else if (mode === "rect" && drag.obj) {
        if (drag.obj.width < 4 && drag.obj.height < 4) canvas.remove(drag.obj);
        else push(drag.obj);
      }
      drag = null;
      canvas.requestRenderAll();
    });
  }

  function makeArrow(x1, y1, x2, y2, c) {
    const dx = x2 - x1, dy = y2 - y1;
    if (Math.hypot(dx, dy) < 6) return null;
    const angle = Math.atan2(dy, dx) * 180 / Math.PI;
    const line = new fabric.Line([x1, y1, x2, y2], { stroke: c, strokeWidth: 3 });
    const head = new fabric.Triangle({
      left: x2, top: y2, originX: "center", originY: "center",
      angle: angle + 90, width: 15, height: 17, fill: c,
    });
    return new fabric.Group([line, head], { selectable: false, evented: false });
  }

  function push(obj) { undoStack.push(obj); }

  function doUndo() {
    if (!canvas || !undoStack.length) return;
    const o = undoStack.pop();
    canvas.remove(o);
    canvas.requestRenderAll();
  }

  function doClear() {
    if (!canvas) return;
    undoStack.slice().forEach((o) => canvas.remove(o));
    undoStack.length = 0;
    canvas.requestRenderAll();
  }

  function removeImage() {
    if (canvas) { canvas.dispose(); canvas = null; }
    undoStack.length = 0;
    els.editor.classList.remove("on");
    els.drop.style.display = "";
    els.file.value = "";
  }

  // Public API used by the form's submit handler
  window.SeedsAnnotator = {
    hasImage() { return !!canvas; },
    exportPng() {
      if (!canvas) return null;
      const disc = canvas.getActiveObject();
      if (disc) { canvas.discardActiveObject(); canvas.requestRenderAll(); }
      // Export at higher resolution than the display canvas, capped.
      const mult = Math.min(MAX_EXPORT_W / canvas.getWidth(), 1 / drawScale) || 1;
      return canvas.toDataURL({ format: "png", multiplier: Math.max(1, mult) });
    },
    reset() { removeImage(); },
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ready);
  else ready();
})();
