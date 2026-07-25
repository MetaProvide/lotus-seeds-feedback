/**
 * Seeds annotator — a small marker.js-style image annotator built on Fabric.js (MIT).
 * Tools: select/move, rectangle, arrow, text, pen, colour, undo, clear.
 * Exposes window.SeedsAnnotator.exportPng() → data URL (flattened image + annotations) or null.
 *
 * Requires Fabric.js loaded before this file.
 */
(function () {
  const COLORS = ["#e5484d", "#f5b301", "#1f6f68", "#111111", "#ffffff"];
  const ICONS = {
    select: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v18M3 12h18M5.5 5.5l13 13M18.5 5.5l-13 13"/></svg>',
    rect: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="14" rx="1"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 19 19 5M10 5h9v9"/></svg>',
    text: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5h14M12 5v14M8 19h8"/></svg>',
    pen: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 5 5 5M4 20l4.5-1L19 8.5 15.5 5 5 15.5 4 20Z"/></svg>',
    undo: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 7 4 12l5 5M4 12h10a6 6 0 0 1 6 6"/></svg>',
    clear: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 18-3-3 9-9 5 5-7 7H7ZM14 19h6"/></svg>',
    remove: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v5M14 11v5M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
  };
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
    const drawGroup = document.createElement("div");
    drawGroup.className = "toolbar-group";
    drawGroup.setAttribute("role", "group");
    drawGroup.setAttribute("aria-label", "Annotation tools");
    const drawLabel = document.createElement("span");
    drawLabel.className = "toolbar-label"; drawLabel.textContent = "Draw";
    const drawControls = document.createElement("div");
    drawControls.className = "tool-controls";
    drawGroup.append(drawLabel, drawControls);
    tools.forEach(([m, label]) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "tool"; b.dataset.mode = m; b.innerHTML = `${ICONS[m]}<span>${label}</span>`;
      b.setAttribute("aria-pressed", "false");
      b.addEventListener("click", () => setMode(m));
      drawControls.appendChild(b);
    });
    els.toolbar.appendChild(drawGroup);

    els.swatches.innerHTML = "";
    COLORS.forEach((c) => {
      const s = document.createElement("button");
      s.type = "button"; s.className = "swatch" + (c === color ? " on" : "");
      s.style.background = c; s.dataset.color = c; s.setAttribute("aria-label", `Use ${c} annotation colour`);
      s.setAttribute("aria-pressed", String(c === color));
      s.addEventListener("click", () => setColor(c));
      els.swatches.appendChild(s);
    });

    const colorGroup = document.createElement("div");
    colorGroup.className = "toolbar-group";
    colorGroup.setAttribute("role", "group");
    colorGroup.setAttribute("aria-label", "Annotation colour");
    const colorLabel = document.createElement("span");
    colorLabel.className = "toolbar-label"; colorLabel.textContent = "Colour";
    colorGroup.append(colorLabel, els.swatches);
    els.toolbar.appendChild(colorGroup);

    const editGroup = document.createElement("div");
    editGroup.className = "toolbar-group";
    editGroup.setAttribute("role", "group");
    editGroup.setAttribute("aria-label", "Image editing actions");
    const editLabel = document.createElement("span");
    editLabel.className = "toolbar-label"; editLabel.textContent = "Edit";
    const editControls = document.createElement("div");
    editControls.className = "tool-controls";
    const actions = [
      { label: "Undo", icon: "undo", action: doUndo },
      { label: "Clear", icon: "clear", action: doClear },
      { label: "Remove image", icon: "remove", action: removeImage },
    ];
    actions.forEach(({ label, icon, action }) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "tool" + (label === "Remove image" ? " danger" : ""); b.innerHTML = `${ICONS[icon]}<span>${label}</span>`;
      b.addEventListener("click", action); editControls.appendChild(b);
    });
    editGroup.append(editLabel, editControls);
    els.toolbar.appendChild(editGroup);
  }

  function setColor(c) {
    color = c;
    [...els.swatches.children].forEach((s) => {
      const selected = s.dataset.color === c;
      s.classList.toggle("on", selected);
      s.setAttribute("aria-pressed", String(selected));
    });
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
    [...els.toolbar.querySelectorAll(".tool[data-mode]")].forEach((b) => {
      const selected = b.dataset.mode === m;
      b.classList.toggle("on", selected);
      b.setAttribute("aria-pressed", String(selected));
    });
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
