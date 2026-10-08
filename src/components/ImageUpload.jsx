import { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import api from "../api/api";

/* ─── constants ─────────────────────────────────────────────── */
const IMAGE_TYPES = [
  { value: "IOPA",      label: "IOPA",             icon: "🦷", desc: "Intra-Oral Periapical" },
  { value: "OPG",       label: "OPG",              icon: "🦴", desc: "Orthopantomogram" },
  { value: "CBCT",      label: "CBCT",             icon: "🔬", desc: "Cone Beam CT" },
  { value: "INTRAORAL", label: "Intra Oral Image",  icon: "📸", desc: "Intraoral Photo" },
];

// Biggest picture the server accepts (images.py: IMAGE_MAX_MB, default 25).
const MAX_UPLOAD_MB = 25;

// Reads the backend URL from Vite's env (VITE_API_URL in .env / .env.production).
// If that's not set for some reason, auto-detect: use localhost when running
// the dev server locally, otherwise fall back to the deployed Render backend.
// This way the same build works correctly on both localhost and Render.
function resolveApiBase() {
  const fromEnv = import.meta.env.VITE_API_URL;
  // .env / .env.production define VITE_API_URL as the API root (with a
  // trailing "/api"), e.g. "https://dental-backend-xojn.onrender.com/api".
  // This file needs the *server* root (no "/api") since it appends "/api/..."
  // itself for endpoints and uses the bare root for static file/image URLs.
  const raw = fromEnv
    ? fromEnv
    : (typeof window !== "undefined" &&
       (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"))
      ? "http://localhost:5000/api"
      : "https://dental-backend-xojn.onrender.com/api";

  return raw.replace(/\/$/, "").replace(/\/api$/, "");
}

const API_BASE = resolveApiBase();

function imgSrc(url) {
  if (!url) return "";
  if (url.startsWith("http")) return url;
  return `${API_BASE}${url}`;
}

/* ─── loading the actual picture ──────────────────────────────────────────────
 * The pictures are FILES on the server (see images.py). The browser gets each
 * one through the same signed-in `api` client used everywhere else, as raw
 * bytes, and shows it from memory.
 *
 * Each picture is downloaded once and then shared: the small card and the
 * full-screen viewer use the same copy, so opening the viewer is instant.
 * ─────────────────────────────────────────────────────────────────────────── */
const pictureCache = new Map();   // server url -> { promise, url (blob:), type, size }

// Backend returns urls like "/api/images/123/data". The `api` client's
// baseURL already includes "/api", so strip the duplicate prefix to
// avoid requesting "/api/api/images/123/data".
function apiPath(src) {
  return src.startsWith("http") ? src : src.replace(/^\/api(?=\/)/, "");
}

async function explainLoadError(err) {
  const status = err?.response?.status;
  const data = err?.response?.data;
  let message = "";
  try {
    if (typeof Blob !== "undefined" && data instanceof Blob) message = JSON.parse(await data.text()).error || "";
    else if (data && typeof data === "object") message = data.error || "";
  } catch { /* not JSON */ }
  if (message) return message;
  if (status === 404) return "The file for this picture is missing on the server.";
  if (status === 401 || status === 403) return "You are not signed in, or not allowed to see this picture.";
  if (!err?.response) return "Could not reach the server.";
  return "The picture could not be loaded.";
}

function loadPicture(src) {
  let entry = pictureCache.get(src);
  if (!entry) {
    entry = { url: null, type: "", size: 0 };
    entry.promise = api.get(apiPath(src), { responseType: "blob" })
      .then((res) => {
        const blob = res.data;
        if (!blob || typeof blob.size !== "number" || blob.size === 0) throw new Error("empty");
        entry.url  = URL.createObjectURL(blob);
        entry.type = blob.type || "";
        entry.size = blob.size;
        return entry;
      })
      .catch(async (err) => {
        pictureCache.delete(src);              // so "Try again" really tries again
        console.error("Failed to load image:", src, err);
        throw new Error(err?.message === "empty" ? "The server sent an empty file for this picture." : await explainLoadError(err));
      });
    pictureCache.set(src, entry);
  }
  return entry.promise;
}

function forgetPicture(src) {
  const entry = pictureCache.get(src);
  if (entry?.url) URL.revokeObjectURL(entry.url);
  pictureCache.delete(src);
}

function forgetAllPictures() {
  [...pictureCache.keys()].forEach(forgetPicture);
}

/**
 * <img src="..."> requests are made directly by the browser and can never
 * carry an Authorization header, so a JWT-protected image endpoint always
 * 401s a plain <img> tag. Instead, fetch the bytes through the same
 * `api` client already used (successfully) for every other authenticated
 * request in this app, then hand the browser a local blob: URL to render.
 */
function AuthImage({ src, alt, style, className, draggable, onMouseOver, onMouseOut }) {
  const [blobUrl, setBlobUrl] = useState(null);
  const [error,   setError]   = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError("");
    setBlobUrl(null);

    if (!src) return;

    loadPicture(src)
      .then((entry) => { if (!cancelled) setBlobUrl(entry.url); })
      .catch((err) => { if (!cancelled) setError(err.message || "The picture could not be loaded."); });

    return () => { cancelled = true; };
  }, [src, attempt]);

  if (error) {
    return (
      <div className={className} role="alert" style={{ ...style, display:"flex", flexDirection:"column", alignItems:"center",
        justifyContent:"center", background:"#1e293b", color:"#cbd5e1", fontSize:12, gap:8, padding:10, textAlign:"center",
        transform:"none", filter:"none" }}>
        <span>⚠️ {error}</span>
        <button type="button" onClick={(e) => { e.stopPropagation(); setAttempt((n) => n + 1); }}
          style={{ padding:"4px 12px", borderRadius:6, border:"1px solid #475569", background:"#0f172a",
            color:"#e2e8f0", fontSize:11.5, fontWeight:600, cursor:"pointer" }}>
          Try again
        </button>
      </div>
    );
  }
  if (!blobUrl) {
    return (
      <div className={className} style={{ ...style, display:"flex", alignItems:"center",
        justifyContent:"center", background:"#0b1120", transform:"none", filter:"none" }}>
        <span className="imgup-spinner" />
      </div>
    );
  }
  return (
    <img src={blobUrl} alt={alt} className={className} style={style} draggable={draggable}
      onMouseOver={onMouseOver} onMouseOut={onMouseOut}
      onError={() => setError("This file is not a picture the browser can display.")} />
  );
}

function todayStr() { return new Date().toISOString().split("T")[0]; }
function fmtDate(d) {
  if (!d) return "—";
  const p = String(d).split("T")[0].split("-");
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : d;
}

/* ─── CBCT constants ─────────────────────────────────────────── */
const CBCT_API = API_BASE + "/api";

const TOOLS = [
  { id: "pan",      icon: "✋", label: "Pan" },
  { id: "window",   icon: "☀️", label: "Window/Level" },
  { id: "measure",  icon: "📏", label: "Measure" },
  { id: "angle",    icon: "📐", label: "Angle" },
  { id: "implant",  icon: "🦷", label: "Implant" },
  { id: "nerve",    icon: "🧠", label: "Nerve (IAN)" },
  { id: "probe",    icon: "🔬", label: "HU Probe" },
  { id: "erase",    icon: "🗑️", label: "Erase" },
];

const WINDOW_PRESETS = [
  { label: "Bone",        wc:  400, ww: 1500 },
  { label: "Soft Tissue", wc:   40, ww:  400 },
  { label: "Enamel",      wc: 2500, ww: 4000 },
  { label: "Airway",      wc: -800, ww: 1000 },
  { label: "Full Range",  wc:  400, ww: 4000 },
];

const IMPLANT_SYSTEMS = [
  { brand: "Nobel Active",  lengths: [8,10,11.5,13,15,18], diameters: [3.0,3.5,4.3,5.0] },
  { brand: "Straumann BL",  lengths: [8,10,12,14,16],      diameters: [3.3,4.1,4.8,6.5] },
  { brand: "Zimmer TSV",    lengths: [8,10,11.5,13,16],    diameters: [3.7,4.7,5.7]     },
  { brand: "Generic",       lengths: [8,10,11,13,15,18],   diameters: [3.0,3.5,4.0,4.5,5.0] },
];

const AXIS_COLORS = { axial: "#22d3ee", coronal: "#f97316", sagittal: "#a78bfa" };
const AXIS_LABELS = { axial: "Axial (Z)", coronal: "Coronal (Y)", sagittal: "Sagittal (X)" };

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function dist2D(a, b) { return Math.sqrt((a.x-b.x)**2 + (a.y-b.y)**2); }
function angleDeg(a,b,c) {
  const ab={x:a.x-b.x,y:a.y-b.y}, cb={x:c.x-b.x,y:c.y-b.y};
  return (Math.atan2(Math.abs(ab.x*cb.y-ab.y*cb.x), ab.x*cb.x+ab.y*cb.y)*180)/Math.PI;
}

/* ─── inject styles ─────────────────────────────────────────── */
const injectStyles = () => {
  if (document.getElementById("imgup-styles-v2")) return;
  const s = document.createElement("style");
  s.id = "imgup-styles-v2";
  s.textContent = `
    @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&family=DM+Mono:wght@400;500&display=swap');
    .imgup-root { font-family: 'Plus Jakarta Sans', sans-serif; }
    .imgup-type-card {
      flex:1; min-width:90px; padding:10px 8px;
      border:2px solid #e2e8f4; border-radius:10px;
      background:#f8fafc; cursor:pointer;
      display:flex; flex-direction:column; align-items:center; gap:4px;
      transition:all 0.18s; text-align:center;
    }
    .imgup-type-card:hover { border-color:#93c5fd; background:#eff6ff; }
    .imgup-type-card.selected { border-color:#1d6fa4; background:#eff6ff; box-shadow:0 0 0 3px rgba(29,111,164,0.12); }
    .imgup-dropzone {
      border:2px dashed #c7d9f5; border-radius:12px;
      background:#f8fafc; padding:16px 20px;
      display:flex; flex-direction:column; align-items:center; gap:8px;
      cursor:pointer; transition:all 0.18s;
    }
    .imgup-dropzone:hover, .imgup-dropzone.drag { border-color:#1d6fa4; background:#eff6ff; }
    .imgup-dropzone.has-file { border-color:#10b981; background:#f0fdf4; border-style:solid; }
    .imgup-img-card {
      background:#fff; border:1.5px solid #e8eef8; border-radius:12px;
      overflow:hidden; transition:box-shadow 0.18s, border-color 0.18s;
    }
    .imgup-img-card:hover { border-color:#c7d9fc; box-shadow:0 4px 18px rgba(29,77,122,0.1); }
    .imgup-lightbox {
      position:fixed; inset:0; z-index:9999;
      background:rgba(5,10,24,0.92); backdrop-filter:blur(8px);
      display:flex; align-items:center; justify-content:center;
      animation:imgup-fade 0.2s ease both;
    }
    @keyframes imgup-fade { from{opacity:0} to{opacity:1} }
    .imgup-lightbox-img {
      max-width:90vw; max-height:82vh;
      border-radius:10px; box-shadow:0 24px 80px rgba(0,0,0,0.7);
      transition:transform 0.2s ease; cursor:grab;
    }
    .imgup-lightbox-img:active { cursor:grabbing; }
    .imgup-lbox-btn {
      width:40px; height:40px; border-radius:10px;
      border:1.5px solid rgba(255,255,255,0.2);
      background:rgba(255,255,255,0.1);
      color:#fff; font-size:18px; cursor:pointer;
      display:flex; align-items:center; justify-content:center;
      transition:background 0.15s;
    }
    .imgup-lbox-btn:hover { background:rgba(255,255,255,0.22); }
    .imgup-modal-overlay {
      position:fixed; inset:0; z-index:9000;
      background:rgba(10,25,55,0.5); backdrop-filter:blur(4px);
      display:flex; align-items:center; justify-content:center;
      font-family:'Plus Jakarta Sans',sans-serif;
      animation:imgup-fade 0.2s ease both;
    }
    .imgup-modal {
      background:#fff; border-radius:18px; padding:28px 30px;
      width:92%; max-width:620px; max-height:92vh; overflow-y:auto;
      box-shadow:0 24px 80px rgba(10,25,55,0.25);
      animation:imgup-slide 0.25s cubic-bezier(.22,.68,0,1.2) both;
    }
    @keyframes imgup-slide { from{opacity:0;transform:translateY(18px) scale(0.97)} to{opacity:1;transform:none} }
    .imgup-edit-modal {
      background:#fff; border-radius:18px; padding:26px 28px;
      width:92%; max-width:460px; max-height:92vh; overflow-y:auto;
      box-shadow:0 24px 80px rgba(10,25,55,0.25);
      animation:imgup-slide 0.25s cubic-bezier(.22,.68,0,1.2) both;
    }
    .imgup-section-hd {
      display:flex; align-items:center; gap:8px;
      padding:8px 14px; border-radius:8px; margin:18px 0 10px;
      background:linear-gradient(90deg,#eff6ff,transparent);
      border-left:3px solid #1d6fa4;
      font-size:12px; font-weight:800; color:#0b2d4e;
      letter-spacing:0.5px; text-transform:uppercase;
    }
    .imgup-icon-btn {
      width:30px; height:30px; border-radius:7px;
      border:1.5px solid #e2e8f4; background:#f7f9fe;
      cursor:pointer; font-size:13px;
      display:inline-flex; align-items:center; justify-content:center;
      transition:all 0.15s;
    }
    .imgup-icon-btn:hover { background:#eff4ff; border-color:#c7d9fc; }
    .imgup-icon-btn.danger:hover { background:#fff1f2; border-color:#fca5a5; }
    @keyframes imgup-spin { to{transform:rotate(360deg)} }
    .imgup-spinner {
      width:16px; height:16px; border-radius:50%;
      border:2px solid #dde8f8; border-top-color:#1d6fa4;
      animation:imgup-spin 0.7s linear infinite; display:inline-block;
    }

    /* ── CBCT tab styles ── */
    .cbct-tab-btn {
      padding:7px 16px; border-radius:8px; border:1.5px solid #e2e8f4;
      background:#f8fafc; color:#64748b; font-size:12.5px; font-weight:700;
      cursor:pointer; transition:all 0.15s; font-family:'Plus Jakarta Sans',sans-serif;
    }
    .cbct-tab-btn.active { background:#0f172a; color:#22d3ee; border-color:#0f172a; }
    .cbct-vol-card {
      display:flex; align-items:center; gap:14px;
      background:#0f172a; border:1.5px solid #1e293b; border-radius:12px;
      padding:14px 16px; transition:border-color 0.15s;
    }
    .cbct-vol-card:hover { border-color:#334155; }
    .cbct-open-btn {
      background:linear-gradient(135deg,#1d4d7a,#1d6fa4); color:#fff; border:none;
      border-radius:9px; padding:9px 18px; font-size:13px; font-weight:700;
      cursor:pointer; white-space:nowrap; font-family:'Plus Jakarta Sans',sans-serif;
      transition:opacity 0.15s; box-shadow:0 4px 12px rgba(29,77,122,0.3);
    }
    .cbct-open-btn:hover { opacity:0.9; }
    .cbct-drop-zone {
      border:2px dashed #1e293b; border-radius:14px; padding:36px 24px;
      text-align:center; cursor:pointer; transition:all 0.2s;
      background:#f8fafc08; user-select:none;
    }
    .cbct-drop-zone:hover, .cbct-drop-zone.drag-over { border-color:#1d6fa4; background:#eff6ff; }
    .cbct-progress-bar { height:6px; background:#e2e8f4; border-radius:4px; overflow:hidden; }
    .cbct-progress-fill { height:100%; background:linear-gradient(135deg,#1d4d7a,#1d6fa4); transition:width 0.4s ease; border-radius:4px; }

    /* ── CBCT Viewer ── */
    .cbct-viewer-root {
      position:fixed; inset:0; z-index:9998;
      background:#020617; display:flex; flex-direction:column;
      font-family:'DM Mono','Fira Code',monospace; color:#e2e8f0;
    }
    .cbct-toolbar-btn {
      display:flex; flex-direction:column; align-items:center;
      background:transparent; border:1.5px solid transparent;
      border-radius:7px; padding:7px 5px; cursor:pointer; color:#94a3b8;
      transition:all 0.15s; width:100%;
    }
    .cbct-toolbar-btn:hover { background:#1e293b; }
    .cbct-toolbar-btn.active { background:#1e3a5f; border-color:#3b82f6; color:#60a5fa; }
    .cbct-preset-btn {
      display:block; width:100%; text-align:left; background:transparent;
      border:none; color:#94a3b8; padding:3px 4px; font-size:11px;
      cursor:pointer; border-radius:4px; font-family:'DM Mono',monospace;
      transition:background 0.1s;
    }
    .cbct-preset-btn:hover { background:#1e293b; }
    .cbct-icon-btn {
      background:transparent; color:#94a3b8; border:none;
      cursor:pointer; font-size:15px; padding:5px 7px; border-radius:5px;
      transition:color 0.15s;
    }
    .cbct-icon-btn:hover { color:#e2e8f0; background:#1e293b; }
    .cbct-layout-btn {
      background:#1e293b; color:#64748b; border:1.5px solid #334155;
      border-radius:5px; padding:4px 10px; font-size:11px;
      cursor:pointer; font-family:'DM Mono',monospace; transition:all 0.15s;
    }
    .cbct-layout-btn.active { background:#1d4ed8; color:#fff; border-color:#3b82f6; }

    /* ── v2: buttons that used to be plain boxes ── */
    button.imgup-type-card { font-family:inherit; }
    .imgup-type-card:focus-visible, .imgup-thumb:focus-visible, .imgup-icon-btn:focus-visible,
    .imgup-lbox-btn:focus-visible, .imgup-viewer-nav:focus-visible { outline:2px solid #60a5fa; outline-offset:2px; }
    .imgup-thumb {
      position:relative; display:block; width:100%; padding:0; border:none; margin:0;
      background:#0b1120; overflow:hidden; cursor:zoom-in; font-family:inherit; text-align:left;
    }
    .imgup-icon-btn:disabled { opacity:0.45; cursor:not-allowed; }

    /* ── v2: list of pictures chosen for upload ── */
    .imgup-pick-list { display:flex; flex-direction:column; gap:6px; margin-top:10px; max-height:210px; overflow-y:auto; }
    .imgup-pick {
      display:flex; align-items:center; gap:10px; padding:6px 8px;
      border:1.5px solid #d1fae5; background:#f0fdf4; border-radius:9px;
    }
    .imgup-pick.bad { border-color:#fecaca; background:#fef2f2; }
    .imgup-pick-thumb { width:46px; height:46px; border-radius:6px; object-fit:cover; background:#0b1120; flex-shrink:0; }

    /* ── v2: full-screen viewer (drawn on the page body, so it always covers the whole screen) ── */
    .imgup-viewer {
      position:fixed; inset:0; z-index:9999;
      background:#040814;
      display:flex; flex-direction:column;
      font-family:'Plus Jakarta Sans',sans-serif;
      animation:imgup-fade 0.18s ease both;
    }
    .imgup-viewer-bar {
      display:flex; align-items:center; gap:8px; flex-wrap:wrap; flex-shrink:0;
      padding:10px 16px;
      background:rgba(255,255,255,0.05); border-bottom:1px solid rgba(255,255,255,0.08);
    }
    .imgup-viewer-title { flex:1 1 160px; min-width:0; }
    .imgup-viewer-tools { display:flex; align-items:center; gap:6px; flex-shrink:0; flex-wrap:wrap; }
    .imgup-viewer-zoom {
      color:#fff; font-size:12px; font-weight:700; font-family:'DM Mono',monospace;
      min-width:50px; text-align:center; background:rgba(255,255,255,0.08); border-radius:7px; padding:5px 8px;
    }
    .imgup-viewer-sep { width:1px; height:22px; background:rgba(255,255,255,0.15); margin:0 2px; }
    .imgup-lbox-btn.wide { width:auto; padding:0 12px; font-size:12px; font-weight:700; font-family:inherit; white-space:nowrap; }
    .imgup-lbox-btn.on { background:#1d6fa4; border-color:#60a5fa; }
    .imgup-lbox-btn:disabled { opacity:0.4; cursor:not-allowed; }
    .imgup-viewer-adjust {
      display:flex; align-items:center; gap:14px; flex-wrap:wrap; flex-shrink:0;
      padding:9px 16px; background:rgba(255,255,255,0.03); border-bottom:1px solid rgba(255,255,255,0.08);
    }
    .imgup-viewer-adjust label { display:flex; align-items:center; gap:8px; font-size:12px; font-weight:600; color:rgba(255,255,255,0.8); }
    .imgup-viewer-adjust label span { font-family:'DM Mono',monospace; font-size:11.5px; min-width:40px; color:rgba(255,255,255,0.6); }
    .imgup-viewer-adjust input[type=range] { width:150px; accent-color:#38bdf8; }
    .imgup-viewer-stage {
      position:relative; flex:1 1 auto; min-height:0; overflow:hidden;
      display:flex; align-items:center; justify-content:center;
      user-select:none; touch-action:none;
    }
    .imgup-viewer-img { flex-shrink:0; object-fit:contain; transform-origin:center center; pointer-events:none; }
    .imgup-viewer-nav {
      position:absolute; top:50%; transform:translateY(-50%);
      width:46px; height:76px; border-radius:12px;
      border:1.5px solid rgba(255,255,255,0.2); background:rgba(15,23,42,0.65);
      color:#fff; font-size:34px; line-height:1; cursor:pointer;
      display:flex; align-items:center; justify-content:center; transition:background 0.15s;
    }
    .imgup-viewer-nav:hover { background:rgba(29,111,164,0.85); }
    .imgup-viewer-nav.left { left:14px; }
    .imgup-viewer-nav.right { right:14px; }
    .imgup-viewer-hint { text-align:center; padding:7px 10px 9px; font-size:11px; color:rgba(255,255,255,0.35); flex-shrink:0; }
    @media (max-width:820px) {
      /* small screens: title and Close on the first line, the tools on a line of their own */
      .imgup-viewer-tools.main { order:3; flex-basis:100%; }
      .imgup-viewer-tools.end .imgup-viewer-sep { display:none; }
    }
    @media (max-width:640px) {
      .imgup-viewer-hint { display:none; }
      .imgup-viewer-bar { padding:8px 10px; }
      .imgup-lbox-btn { width:36px; height:36px; }
      .imgup-lbox-btn.wide { padding:0 9px; }
      .imgup-viewer-adjust input[type=range] { width:110px; }
    }
  `;
  document.head.appendChild(s);
};

/* Every pop-up window is drawn directly on the page body. If it were drawn
   inside the "Image Upload" card it would be trapped inside that card (cards on
   the visit page are animated, and an animated box becomes the frame for
   anything "fixed" inside it) — which is why the viewer used to show only its
   title bar while the picture sat somewhere off-screen. */
function inBody(node) {
  return createPortal(node, document.body);
}

function useLockPageScroll() {
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, []);
}

function fmtSize(bytes) {
  if (!bytes && bytes !== 0) return "";
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function serverMessage(err, fallback) {
  const fromServer = err?.response?.data?.error;
  if (fromServer) return fromServer;
  if (err?.response?.status === 413) return `This picture is too large. The limit is ${MAX_UPLOAD_MB} MB.`;
  if (!err?.response) return `${fallback} The server could not be reached — please check the connection.`;
  return fallback;
}

function downloadName(img, type) {
  const ext = { "image/png":"png", "image/webp":"webp", "image/gif":"gif", "image/bmp":"bmp", "application/pdf":"pdf" }[type || img.mime_type] || "jpg";
  return `${img.type || "image"}_${img.image_date || "undated"}_${img.id}.${ext}`;
}

/* ═══════════════════════════════════════════
   LIGHTBOX  — full-screen viewer
   zoom · drag to move · rotate · brightness / contrast / invert ·
   previous / next · download
═══════════════════════════════════════════ */
function Lightbox({ img, images = [], onNavigate, onClose }) {
  const MIN = 0.5, MAX = 8, STEP = 0.35;
  const [zoom,       setZoom]       = useState(1);
  const [pan,        setPan]        = useState({ x:0, y:0 });
  const [rotation,   setRotation]   = useState(0);
  const [brightness, setBrightness] = useState(100);
  const [contrast,   setContrast]   = useState(100);
  const [invert,     setInvert]     = useState(false);
  const [showAdjust, setShowAdjust] = useState(false);
  const [dragging,   setDragging]   = useState(false);
  const [stage,      setStage]      = useState({ w:0, h:0 });
  const [picture,    setPicture]    = useState(null);     // { url, type } once loaded
  const [error,      setError]      = useState("");
  const [attempt,    setAttempt]    = useState(0);
  const dragRef  = useRef(null);
  const stageRef = useRef(null);

  useLockPageScroll();

  const index   = images.findIndex(i => i.id === img.id);
  const hasPrev = index > 0;
  const hasNext = index >= 0 && index < images.length - 1;
  const go = (step) => { const next = images[index + step]; if (next && onNavigate) onNavigate(next); };

  const resetView = () => { setZoom(1); setPan({ x:0, y:0 }); };
  const applyZoom = (next) => {
    const z = Math.min(Math.max(next, MIN), MAX);
    setZoom(z);
    if (z <= 1) setPan({ x:0, y:0 });
  };
  const rotate = (deg) => { setRotation(r => (r + deg + 360) % 360); setPan({ x:0, y:0 }); };
  const adjusted = brightness !== 100 || contrast !== 100 || invert;
  const resetAdjust = () => { setBrightness(100); setContrast(100); setInvert(false); };

  // A different picture: load it and start from a clean view
  useEffect(() => {
    let cancelled = false;
    setPicture(null); setError("");
    setZoom(1); setPan({ x:0, y:0 }); setRotation(0);
    setBrightness(100); setContrast(100); setInvert(false);
    if (img.available === false) { setError("The file for this picture is missing on the server."); return; }
    loadPicture(img.url)
      .then(entry => { if (!cancelled) setPicture({ url: entry.url, type: entry.type }); })
      .catch(err => { if (!cancelled) setError(err.message || "The picture could not be loaded."); });
    return () => { cancelled = true; };
  }, [img.id, img.url, img.available, attempt]);

  // Size of the viewing area (so a rotated picture still fits)
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => setStage(prev =>
      (prev.w === el.clientWidth && prev.h === el.clientHeight) ? prev : { w: el.clientWidth, h: el.clientHeight });
    measure();
    window.addEventListener("resize", measure);
    // also when the tool strip opens or closes and the viewing area changes height
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    if (observer) observer.observe(el);
    return () => { window.removeEventListener("resize", measure); if (observer) observer.disconnect(); };
  }, []);

  useEffect(() => {
    const h = (e) => {
      if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) && e.key !== "Escape") return;
      if (e.key === "Escape") onClose();
      else if (e.key === "+" || e.key === "=") applyZoom(zoom + STEP);
      else if (e.key === "-") applyZoom(zoom - STEP);
      else if (e.key === "0") resetView();
      else if (e.key === "ArrowLeft")  go(-1);
      else if (e.key === "ArrowRight") go(1);
      else if (e.key === "r" || e.key === "R") rotate(90);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });

  const handleWheel = (e) => { e.preventDefault(); applyZoom(zoom + (e.deltaY < 0 ? STEP : -STEP)); };
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  });

  const onPointerDown = (e) => {
    if (zoom <= 1 || e.button > 0) return;
    e.preventDefault();
    dragRef.current = { startX:e.clientX, startY:e.clientY, panX:pan.x, panY:pan.y };
    setDragging(true);
  };
  const onPointerMove = (e) => {
    if (!dragging || !dragRef.current) return;
    setPan({ x: dragRef.current.panX + e.clientX - dragRef.current.startX,
             y: dragRef.current.panY + e.clientY - dragRef.current.startY });
  };
  const onPointerUp = () => setDragging(false);

  const typeObj = IMAGE_TYPES.find(t => t.value === img.type) || { label: img.type };
  const isPdf   = (picture?.type || img.mime_type) === "application/pdf";

  // The picture always fills the viewing area as far as its shape allows —
  // also after turning it on its side.
  const sideways = rotation % 180 !== 0;
  const boxW = Math.max(60, (sideways ? stage.h : stage.w) - 24);
  const boxH = Math.max(60, (sideways ? stage.w : stage.h) - 24);

  const download = () => {
    if (!picture) return;
    const a = document.createElement("a");
    a.href = picture.url;
    a.download = downloadName(img, picture.type);
    document.body.appendChild(a); a.click(); a.remove();
  };

  return inBody(
    <div className="imgup-viewer" role="dialog" aria-modal="true" aria-label={`${typeObj.label} picture viewer`}>
      {/* ── top bar ── */}
      <div className="imgup-viewer-bar">
        <div className="imgup-viewer-title">
          <div style={{ fontSize:13.5, fontWeight:700, color:"#fff", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
            {typeObj.label}
            {img.description && <span style={{ fontWeight:400, color:"rgba(255,255,255,0.65)", marginLeft:8 }}>{img.description}</span>}
          </div>
          <div style={{ fontSize:11.5, color:"rgba(255,255,255,0.5)", marginTop:2 }}>
            {img.image_date && <>📅 {fmtDate(img.image_date)}</>}
            {images.length > 1 && index >= 0 && <span style={{ marginLeft: img.image_date ? 10 : 0 }}>Picture {index + 1} of {images.length}</span>}
          </div>
        </div>
        {!isPdf && (
          <div className="imgup-viewer-tools main">
            <button type="button" className="imgup-lbox-btn" onClick={()=>applyZoom(zoom-STEP)} title="Zoom out (−)" aria-label="Zoom out">−</button>
            <span className="imgup-viewer-zoom" aria-live="polite">{Math.round(zoom*100)}%</span>
            <button type="button" className="imgup-lbox-btn" onClick={()=>applyZoom(zoom+STEP)} title="Zoom in (+)" aria-label="Zoom in">+</button>
            <button type="button" className="imgup-lbox-btn wide" onClick={resetView} title="Fit to screen (0)" aria-label="Fit to screen">Fit</button>
            <span className="imgup-viewer-sep"/>
            <button type="button" className="imgup-lbox-btn" onClick={()=>rotate(-90)} title="Turn left" aria-label="Turn left">⟲</button>
            <button type="button" className="imgup-lbox-btn" onClick={()=>rotate(90)} title="Turn right (R)" aria-label="Turn right">⟳</button>
            <button type="button" className={`imgup-lbox-btn wide${showAdjust || adjusted ? " on" : ""}`} onClick={()=>setShowAdjust(s=>!s)}
              title="Brightness, contrast, invert" aria-label="Brightness and contrast" aria-expanded={showAdjust}>☀ Adjust</button>
          </div>
        )}
        <div className="imgup-viewer-tools end">
          <span className="imgup-viewer-sep"/>
          <button type="button" className="imgup-lbox-btn" onClick={download} disabled={!picture} title="Download" aria-label="Download">⬇</button>
          <button type="button" className="imgup-lbox-btn" onClick={onClose} title="Close (Esc)" aria-label="Close" style={{ fontSize:16 }}>✕</button>
        </div>
      </div>

      {/* ── brightness / contrast ── */}
      {showAdjust && !isPdf && (
        <div className="imgup-viewer-adjust">
          <label>Brightness
            <input type="range" min={40} max={220} value={brightness} onChange={e=>setBrightness(+e.target.value)} aria-label="Brightness" />
            <span>{brightness}%</span>
          </label>
          <label>Contrast
            <input type="range" min={40} max={250} value={contrast} onChange={e=>setContrast(+e.target.value)} aria-label="Contrast" />
            <span>{contrast}%</span>
          </label>
          <button type="button" className={`imgup-lbox-btn wide${invert ? " on" : ""}`} onClick={()=>setInvert(v=>!v)} aria-pressed={invert}>◐ Invert</button>
          <button type="button" className="imgup-lbox-btn wide" onClick={resetAdjust} disabled={!adjusted}>Reset</button>
          <span style={{ fontSize:11, color:"rgba(255,255,255,0.4)" }}>Only changes how it looks here — the saved picture is not altered.</span>
        </div>
      )}

      {/* ── the picture ── */}
      <div ref={stageRef} className="imgup-viewer-stage"
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={onPointerUp}
        onDoubleClick={() => (zoom === 1 ? applyZoom(2) : resetView())}
        style={{ cursor: zoom>1 ? (dragging ? "grabbing" : "grab") : "default" }}>

        {error && (
          <div role="alert" style={{ textAlign:"center", color:"#e2e8f0", maxWidth:420, padding:20 }}>
            <div style={{ fontSize:36, marginBottom:10 }}>⚠️</div>
            <div style={{ fontSize:14, fontWeight:600, marginBottom:14 }}>{error}</div>
            <button type="button" className="imgup-lbox-btn wide" style={{ margin:"0 auto" }} onClick={()=>setAttempt(n=>n+1)}>Try again</button>
          </div>
        )}
        {!error && !picture && (
          <div style={{ color:"rgba(255,255,255,0.6)", fontSize:13, display:"flex", alignItems:"center", gap:10 }}>
            <span className="imgup-spinner" /> Loading picture…
          </div>
        )}
        {!error && picture && isPdf && (
          <iframe title={img.description || "PDF"} src={picture.url}
            style={{ width:"100%", height:"100%", border:0, background:"#fff" }} />
        )}
        {!error && picture && !isPdf && (
          <img src={picture.url} alt={img.description || `${typeObj.label} picture`} draggable={false}
            className="imgup-viewer-img"
            onError={() => setError("This file is not a picture the browser can display.")}
            style={{
              width: boxW, height: boxH,
              transform: `translate(${pan.x}px,${pan.y}px) rotate(${rotation}deg) scale(${zoom})`,
              filter: adjusted ? `brightness(${brightness}%) contrast(${contrast}%) invert(${invert ? 1 : 0})` : "none",
              transition: dragging ? "none" : "transform 0.15s ease",
            }} />
        )}

        {hasPrev && (
          <button type="button" className="imgup-viewer-nav left" onClick={()=>go(-1)} title="Previous picture (←)" aria-label="Previous picture">‹</button>
        )}
        {hasNext && (
          <button type="button" className="imgup-viewer-nav right" onClick={()=>go(1)} title="Next picture (→)" aria-label="Next picture">›</button>
        )}
      </div>

      <div className="imgup-viewer-hint">
        Scroll or +/− to zoom · drag to move · double-click to zoom · R to turn{images.length > 1 ? " · ← → for other pictures" : ""} · Esc to close
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   UPLOAD MODAL — one or several pictures at a time
═══════════════════════════════════════════ */
let pickSeq = 0;

function UploadModal({ onClose, onUploaded, visitId }) {
  const [selType,     setSelType]     = useState(null);
  const [picks,       setPicks]       = useState([]);     // [{ key, file, preview, error }]
  const [description, setDescription] = useState("");
  const [imageDate,   setImageDate]   = useState(todayStr());
  const [drag,        setDrag]        = useState(false);
  const [uploading,   setUploading]   = useState(false);
  const [progress,    setProgress]    = useState("");
  const [message,     setMessage]     = useState("");
  const fileRef  = useRef();
  const picksRef = useRef([]);
  picksRef.current = picks;

  useLockPageScroll();

  // free the preview memory when the window closes
  useEffect(() => () => { picksRef.current.forEach(p => p.preview && URL.revokeObjectURL(p.preview)); }, []);

  const checkFile = (f) => {
    const isHeic = /\.(heic|heif)$/i.test(f.name) || /hei[cf]/i.test(f.type);
    if (isHeic) return "iPhone HEIC photos cannot be displayed in the browser. Please save it as JPG first.";
    if (!f.type.startsWith("image/")) return "This is not a picture file. Use JPG, PNG or WEBP.";
    if (f.size === 0) return "This file is empty.";
    if (f.size > MAX_UPLOAD_MB * 1048576) return `Too large (${fmtSize(f.size)}). The limit is ${MAX_UPLOAD_MB} MB.`;
    return "";
  };

  const addFiles = (list) => {
    const incoming = Array.from(list || []);
    if (incoming.length === 0) return;
    setMessage("");
    setPicks(prev => [
      ...prev,
      ...incoming.map(f => {
        const error = checkFile(f);
        return { key: ++pickSeq, file: f, error, preview: !error ? URL.createObjectURL(f) : null };
      }),
    ]);
  };

  const removePick = (key) => {
    setPicks(prev => {
      const gone = prev.find(p => p.key === key);
      if (gone?.preview) URL.revokeObjectURL(gone.preview);
      return prev.filter(p => p.key !== key);
    });
  };

  const handleDrop = (e) => {
    e.preventDefault(); setDrag(false);
    if (!uploading) addFiles(e.dataTransfer.files);
  };

  const ready = picks.filter(p => !p.error);
  const canUpload = !!selType && ready.length > 0 && !uploading;

  const handleUpload = async () => {
    if (!canUpload) return;
    setUploading(true); setMessage("");
    let done = 0;
    const failed = [];
    for (let i = 0; i < ready.length; i++) {
      const pick = ready[i];
      setProgress(ready.length > 1 ? `Uploading ${i + 1} of ${ready.length}…` : "Uploading…");
      try {
        const fd = new FormData();
        fd.append("image",       pick.file);
        fd.append("type",        selType);
        fd.append("description", description);
        fd.append("image_date",  imageDate);
        await api.post(`/visits/${visitId}/images`, fd, { headers:{ "Content-Type":"multipart/form-data" } });
        done += 1;
        if (pick.preview) URL.revokeObjectURL(pick.preview);
        setPicks(prev => prev.filter(p => p.key !== pick.key));
      } catch (err) {
        console.error("Upload failed", err);
        const why = serverMessage(err, "Upload failed.");
        failed.push(pick.key);
        setPicks(prev => prev.map(p => p.key === pick.key ? { ...p, uploadError: why } : p));
      }
    }
    setUploading(false); setProgress("");
    if (done > 0) onUploaded();
    if (failed.length === 0) { onClose(); return; }
    setMessage(done > 0
      ? `${done} uploaded. ${failed.length} could not be uploaded — see below.`
      : `${failed.length === 1 ? "The picture" : "The pictures"} could not be uploaded — see below.`);
  };

  const selTypeObj = IMAGE_TYPES.find(t => t.value === selType);
  const closeIfIdle = () => { if (!uploading && picks.length === 0) onClose(); };
  const lbl = { fontSize:10.5,fontWeight:700,color:"#8899bb",letterSpacing:"0.7px",textTransform:"uppercase",display:"block",marginBottom:5 };

  return inBody(
    <div className="imgup-modal-overlay" onClick={closeIfIdle}>
      <div className="imgup-modal" role="dialog" aria-modal="true" aria-label="Upload pictures" onClick={e=>e.stopPropagation()}>
        <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:18 }}>
          <div>
            <div style={{ fontSize:16,fontWeight:800,color:"#0b2d4e" }}>
              📸 Upload {selTypeObj ? selTypeObj.label : "Clinical Images"}
            </div>
            <div style={{ fontSize:12,color:"#94a3b8",marginTop:2 }}>
              {selTypeObj ? selTypeObj.desc : "Choose the kind of picture, then add one or more files"}
            </div>
          </div>
          <button type="button" onClick={onClose} disabled={uploading} aria-label="Close" style={{ width:30,height:30,borderRadius:8,border:"1.5px solid #e2e8f4",
            background:"#f7f9fe",fontSize:15,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center" }}>✕</button>
        </div>

        {/* 1 — kind of picture */}
        <label style={lbl}>1 · Kind of picture</label>
        <div style={{ display:"flex",gap:10,flexWrap:"wrap" }} role="group" aria-label="Kind of picture">
          {IMAGE_TYPES.map(t => (
            <button type="button" key={t.value} className={`imgup-type-card ${selType===t.value?"selected":""}`}
              aria-pressed={selType===t.value}
              onClick={()=>setSelType(t.value)}>
              <span style={{ fontSize:22 }}>{t.icon}</span>
              <span style={{ fontSize:12,fontWeight:700,color:"#0b2d4e" }}>{t.label}</span>
              <span style={{ fontSize:10,color:"#94a3b8",lineHeight:1.3 }}>{t.desc}</span>
            </button>
          ))}
        </div>
        {selType === "CBCT" && (
          <div style={{ fontSize:11.5,color:"#92400e",background:"#fffbeb",border:"1px solid #fde68a",borderRadius:8,padding:"7px 10px",marginTop:8 }}>
            This is for a <b>picture</b> of a CBCT (a screenshot or exported slice). To load a full CBCT scan, use the “CBCT Volumes” tab.
          </div>
        )}

        {/* 2 — files */}
        <label style={{ ...lbl, marginTop:16 }}>2 · Pictures</label>
        <div className={`imgup-dropzone ${drag?"drag":""} ${ready.length?"has-file":""}`}
          onClick={()=>!uploading && fileRef.current?.click()}
          onDragOver={e=>{e.preventDefault();setDrag(true);}}
          onDragLeave={()=>setDrag(false)} onDrop={handleDrop}>
          <span style={{ fontSize:28 }}>🖼️</span>
          <span style={{ fontSize:13.5,fontWeight:600,color:"#475569" }}>
            {picks.length ? "Click or drop to add more pictures" : "Click or drag & drop pictures here"}
          </span>
          <span style={{ fontSize:11.5,color:"#94a3b8" }}>JPG, PNG, WEBP · up to {MAX_UPLOAD_MB} MB each · several at once is fine</span>
          <input ref={fileRef} type="file" accept="image/*" multiple style={{ display:"none" }}
            aria-label="Choose pictures"
            onChange={e=>{ addFiles(e.target.files); e.target.value = ""; }} />
        </div>

        {picks.length > 0 && (
          <div className="imgup-pick-list">
            {picks.map(p => (
              <div key={p.key} className={`imgup-pick${p.error || p.uploadError ? " bad" : ""}`}>
                {p.preview
                  ? <img src={p.preview} alt="" className="imgup-pick-thumb" />
                  : <div className="imgup-pick-thumb" style={{ display:"flex",alignItems:"center",justifyContent:"center",fontSize:18 }}>⚠️</div>}
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:12.5,fontWeight:600,color:"#1e293b",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{p.file.name}</div>
                  {p.error || p.uploadError
                    ? <div role="alert" style={{ fontSize:11.5,color:"#b91c1c",fontWeight:600,marginTop:2 }}>{p.error || p.uploadError}</div>
                    : <div style={{ fontSize:11,color:"#64748b",marginTop:2 }}>{fmtSize(p.file.size)}</div>}
                </div>
                <button type="button" className="imgup-icon-btn danger" disabled={uploading} onClick={()=>removePick(p.key)}
                  title="Remove from this upload" aria-label={`Remove ${p.file.name}`}>✕</button>
              </div>
            ))}
          </div>
        )}

        {/* 3 — details */}
        <div style={{ display:"grid",gridTemplateColumns:"minmax(0,170px) minmax(0,1fr)",gap:12,marginTop:16 }}>
          <div>
            <label style={lbl}>Image Date</label>
            <input type="date" value={imageDate} onChange={e=>setImageDate(e.target.value || todayStr())} aria-label="Image date"
              style={{ width:"100%",padding:"9px 12px",border:"1.5px solid #e2e8f0",borderRadius:9,
                fontFamily:"'DM Mono',monospace",fontSize:13,color:"#1e293b",background:"#f8fafc",
                outline:"none",boxSizing:"border-box" }} />
          </div>
          <div>
            <label style={lbl}>
              Description <span style={{ fontWeight:400,textTransform:"none",color:"#94a3b8" }}>
                (optional{ready.length > 1 ? " — used for all of them" : ""})
              </span>
            </label>
            <textarea value={description} onChange={e=>setDescription(e.target.value)} aria-label="Description"
              placeholder="e.g. Upper left molar region, post-RCT…" rows={2}
              style={{ width:"100%",padding:"9px 12px",border:"1.5px solid #e2e8f0",borderRadius:9,
                fontFamily:"'Plus Jakarta Sans',sans-serif",fontSize:13,color:"#1e293b",
                background:"#f8fafc",outline:"none",resize:"vertical",boxSizing:"border-box" }} />
          </div>
        </div>

        {message && (
          <div role="alert" style={{ marginTop:12,fontSize:12.5,fontWeight:600,color:"#b91c1c",background:"#fef2f2",
            border:"1px solid #fecaca",borderRadius:8,padding:"8px 12px" }}>⚠️ {message}</div>
        )}

        <div style={{ display:"flex",gap:10,marginTop:18,alignItems:"center" }}>
          <span style={{ flex:1,fontSize:12,color:"#64748b" }}>
            {!selType ? "Choose the kind of picture first." : ready.length === 0 ? "Now add at least one picture." : ""}
          </span>
          <button type="button" onClick={onClose} disabled={uploading} style={{ padding:"11px 18px",borderRadius:10,background:"transparent",
            color:"#64748b",border:"1.5px solid #e2e8f4",fontFamily:"'Plus Jakarta Sans',sans-serif",
            fontSize:13.5,fontWeight:600,cursor:"pointer" }}>Cancel</button>
          <button type="button" onClick={handleUpload} disabled={!canUpload} style={{
            padding:"11px 22px",borderRadius:10,
            background:canUpload?"linear-gradient(135deg,#0d6e4a,#10b981)":"#e2e8f0",
            color:canUpload?"#fff":"#94a3b8",border:"none",
            fontFamily:"'Plus Jakarta Sans',sans-serif",fontSize:14,fontWeight:700,
            cursor:canUpload?"pointer":"not-allowed",
            display:"flex",alignItems:"center",justifyContent:"center",gap:8 }}>
            {uploading ? <><span className="imgup-spinner"/> {progress}</>
              : ready.length > 1 ? `✓ Upload ${ready.length} Images` : "✓ Upload Image"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   EDIT MODAL
═══════════════════════════════════════════ */
function EditModal({ img, onClose, onSaved }) {
  const [description, setDescription] = useState(img.description||"");
  const [imageDate,   setImageDate]   = useState(img.image_date||todayStr());
  const [type,        setType]        = useState(img.type||"IOPA");
  const [saving,      setSaving]      = useState(false);
  const [error,       setError]       = useState("");

  useLockPageScroll();

  const handleSave = async () => {
    setSaving(true); setError("");
    try {
      await api.put(`/images/${img.id}`, { description, image_date:imageDate, type });
      onSaved(); onClose();
    } catch(err) { console.error("Edit failed",err); setError(serverMessage(err, "The changes were NOT saved.")); }
    finally { setSaving(false); }
  };

  return inBody(
    <div className="imgup-modal-overlay" onClick={()=>!saving && onClose()}>
      <div className="imgup-edit-modal" role="dialog" aria-modal="true" aria-label="Edit image details" onClick={e=>e.stopPropagation()}>
        <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:18 }}>
          <div style={{ fontSize:15,fontWeight:800,color:"#0b2d4e" }}>✏️ Edit Image Details</div>
          <button type="button" onClick={onClose} aria-label="Close" style={{ width:28,height:28,borderRadius:7,border:"1.5px solid #e2e8f4",
            background:"#f7f9fe",fontSize:14,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center" }}>✕</button>
        </div>
        <div style={{ marginBottom:12 }}>
          <label style={{ fontSize:10.5,fontWeight:700,color:"#8899bb",letterSpacing:"0.7px",textTransform:"uppercase",display:"block",marginBottom:5 }}>Image Type</label>
          <select value={type} onChange={e=>setType(e.target.value)} aria-label="Image type" style={{ width:"100%",padding:"9px 12px",
            border:"1.5px solid #e2e8f0",borderRadius:9,fontFamily:"'Plus Jakarta Sans',sans-serif",
            fontSize:13,color:"#1e293b",background:"#f8fafc",outline:"none" }}>
            {IMAGE_TYPES.map(t=><option key={t.value} value={t.value}>{t.label} — {t.desc}</option>)}
          </select>
        </div>
        <div style={{ marginBottom:12 }}>
          <label style={{ fontSize:10.5,fontWeight:700,color:"#8899bb",letterSpacing:"0.7px",textTransform:"uppercase",display:"block",marginBottom:5 }}>Image Date</label>
          <input type="date" value={imageDate} onChange={e=>setImageDate(e.target.value)} aria-label="Image date"
            style={{ width:"100%",padding:"9px 12px",border:"1.5px solid #e2e8f0",borderRadius:9,
              fontFamily:"'DM Mono',monospace",fontSize:13,color:"#1e293b",background:"#f8fafc",
              outline:"none",boxSizing:"border-box" }} />
        </div>
        <div style={{ marginBottom:18 }}>
          <label style={{ fontSize:10.5,fontWeight:700,color:"#8899bb",letterSpacing:"0.7px",textTransform:"uppercase",display:"block",marginBottom:5 }}>Description</label>
          <textarea value={description} onChange={e=>setDescription(e.target.value)} rows={3} aria-label="Description"
            placeholder="Image description…" style={{ width:"100%",padding:"9px 12px",
              border:"1.5px solid #e2e8f0",borderRadius:9,fontFamily:"'Plus Jakarta Sans',sans-serif",
              fontSize:13,color:"#1e293b",background:"#f8fafc",outline:"none",
              resize:"vertical",boxSizing:"border-box" }} />
        </div>
        {error && (
          <div role="alert" style={{ marginBottom:12,fontSize:12.5,fontWeight:600,color:"#b91c1c",background:"#fef2f2",
            border:"1px solid #fecaca",borderRadius:8,padding:"8px 12px" }}>⚠️ {error}</div>
        )}
        <div style={{ display:"flex",gap:10 }}>
          <button type="button" onClick={onClose} disabled={saving} style={{ flex:1,padding:10,borderRadius:9,background:"transparent",
            color:"#64748b",border:"1.5px solid #e2e8f4",fontFamily:"'Plus Jakarta Sans',sans-serif",
            fontSize:13.5,fontWeight:600,cursor:"pointer" }}>Cancel</button>
          <button type="button" onClick={handleSave} disabled={saving} style={{ flex:2,padding:10,borderRadius:9,
            background:saving?"#e2e8f0":"linear-gradient(135deg,#1d4d7a,#1d6fa4)",
            color:saving?"#94a3b8":"#fff",border:"none",fontFamily:"'Plus Jakarta Sans',sans-serif",
            fontSize:14,fontWeight:700,cursor:saving?"not-allowed":"pointer",
            display:"flex",alignItems:"center",justifyContent:"center",gap:8 }}>
            {saving?<><span className="imgup-spinner"/> Saving…</>:"💾 Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   DELETE CONFIRMATION
═══════════════════════════════════════════ */
function DeleteModal({ img, onClose, onDeleted }) {
  const [deleting, setDeleting] = useState(false);
  const [error,    setError]    = useState("");
  const typeObj = IMAGE_TYPES.find(t=>t.value===img.type)||{label:img.type};

  useLockPageScroll();

  const handleDelete = async () => {
    setDeleting(true); setError("");
    try {
      await api.delete(`/images/${img.id}`);
      forgetPicture(img.url);
      onDeleted(); onClose();
    } catch (err) {
      if (err?.response?.status === 404) { forgetPicture(img.url); onDeleted(); onClose(); return; }   // already gone
      console.error("Delete failed", err);
      setError(serverMessage(err, "The picture was NOT deleted."));
      setDeleting(false);
    }
  };

  return inBody(
    <div className="imgup-modal-overlay" onClick={()=>!deleting && onClose()}>
      <div className="imgup-edit-modal" role="dialog" aria-modal="true" aria-label="Delete picture" style={{ maxWidth:400 }} onClick={e=>e.stopPropagation()}>
        <div style={{ fontSize:32,marginBottom:10 }}>🗑️</div>
        <div style={{ fontSize:16,fontWeight:800,color:"#0b2d4e",marginBottom:8 }}>Delete this {typeObj.label} picture?</div>
        <div style={{ fontSize:13,color:"#64748b",marginBottom:6,lineHeight:1.6 }}>
          {img.description ? <>“{img.description}” · </> : null}{fmtDate(img.image_date)}
        </div>
        <div style={{ fontSize:13,color:"#64748b",marginBottom:18,lineHeight:1.6 }}>
          The picture file is removed from the server. This cannot be undone.
        </div>
        {error && (
          <div role="alert" style={{ marginBottom:12,fontSize:12.5,fontWeight:600,color:"#b91c1c",background:"#fef2f2",
            border:"1px solid #fecaca",borderRadius:8,padding:"8px 12px" }}>⚠️ {error}</div>
        )}
        <div style={{ display:"flex",gap:10 }}>
          <button type="button" onClick={onClose} disabled={deleting} style={{ flex:1,padding:10,borderRadius:9,background:"transparent",
            color:"#64748b",border:"1.5px solid #e2e8f4",fontFamily:"'Plus Jakarta Sans',sans-serif",
            fontSize:13.5,fontWeight:600,cursor:"pointer" }}>No, keep it</button>
          <button type="button" onClick={handleDelete} disabled={deleting} style={{ flex:1,padding:10,borderRadius:9,
            background:"linear-gradient(135deg,#dc2626,#ef4444)",color:"#fff",border:"none",
            fontFamily:"'Plus Jakarta Sans',sans-serif",fontSize:14,fontWeight:700,cursor:"pointer",opacity:deleting?0.65:1 }}>
            {deleting ? "Deleting…" : "Yes, delete"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   IMAGE CARD
═══════════════════════════════════════════ */
function ImageCard({ img, disabled, onEdit, onDelete, onView }) {
  const typeObj = IMAGE_TYPES.find(t=>t.value===img.type)||{icon:"📄",label:img.type};
  const missing = img.available === false;
  const isPdf   = img.mime_type === "application/pdf";
  return (
    <div className="imgup-img-card">
      <button type="button" className="imgup-thumb" onClick={()=>onView(img)}
        aria-label={`View ${typeObj.label} picture${img.description ? `: ${img.description}` : ""}`}>
        {missing ? (
          <div style={{ width:"100%",height:160,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
            gap:6,background:"#1e293b",color:"#cbd5e1",fontSize:12,padding:10,textAlign:"center" }}>
            <span style={{ fontSize:22 }}>⚠️</span>
            The file for this picture is missing on the server
          </div>
        ) : isPdf ? (
          <div style={{ width:"100%",height:160,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
            gap:6,background:"#0b1120",color:"#e2e8f0",fontSize:12.5 }}>
            <span style={{ fontSize:34 }}>📄</span>PDF document
          </div>
        ) : (
          <AuthImage src={img.url} alt={img.description||img.type}
            style={{ width:"100%",height:160,objectFit:"cover",display:"block",
              transition:"transform 0.22s",filter:"brightness(0.92)" }}
            onMouseOver={e=>e.currentTarget.style.transform="scale(1.04)"}
            onMouseOut={e=>e.currentTarget.style.transform="scale(1)"} />
        )}
        <span style={{ position:"absolute",top:8,left:8,background:"rgba(11,45,78,0.78)",
          backdropFilter:"blur(4px)",borderRadius:6,padding:"3px 9px",
          fontSize:11,fontWeight:700,color:"#fff",letterSpacing:"0.3px" }}>
          {typeObj.icon} {typeObj.label}
        </span>
        {!missing && (
          <span style={{ position:"absolute",bottom:8,right:8,background:"rgba(0,0,0,0.6)",
            borderRadius:20,padding:"2px 9px",fontSize:10.5,color:"rgba(255,255,255,0.9)" }}>
            🔍 Click to view
          </span>
        )}
      </button>
      <div style={{ padding:"10px 12px" }}>
        <div style={{ display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:8 }}>
          <div style={{ flex:1,minWidth:0 }}>
            {img.image_date && <div style={{ fontSize:11,fontWeight:700,color:"#1d6fa4",
              fontFamily:"'DM Mono',monospace",marginBottom:3 }}>📅 {fmtDate(img.image_date)}</div>}
            {img.description
              ? <div style={{ fontSize:12.5,color:"#374151",lineHeight:1.5,overflowWrap:"anywhere" }}>{img.description}</div>
              : <div style={{ fontSize:12,color:"#94a3b8",fontStyle:"italic" }}>No description</div>}
            {img.uploaded_at && <div style={{ fontSize:10.5,color:"#94a3b8",marginTop:4 }}>
              Uploaded: {img.uploaded_at}{img.size ? ` · ${fmtSize(img.size)}` : ""}
            </div>}
          </div>
          {!disabled && (
            <div style={{ display:"flex",gap:5,flexShrink:0 }}>
              <button type="button" className="imgup-icon-btn" onClick={()=>onEdit(img)} title="Edit details" aria-label="Edit details">✏️</button>
              <button type="button" className="imgup-icon-btn danger" onClick={()=>onDelete(img)} title="Delete" aria-label="Delete picture">🗑️</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   CBCT SLICE PANEL  (one MPR viewport)
═══════════════════════════════════════════ */
function SlicePanel({ axis, volumeId, sliceIndex, totalSlices, wc, ww,
  tool, zoom, pan, crosshair, onCrosshairChange, annotations, onAnnotationAdd,
  onSliceChange, onWindowChange, onPanChange, onZoomChange, active, onActivate }) {

  const canvasRef = useRef(null);
  const imgRef    = useRef(new window.Image());
  const dragRef   = useRef(null);
  const annPts    = useRef([]);

  const sliceUrl = `${CBCT_API}/cbct/${volumeId}/slice/${axis}/${sliceIndex}`;

  useEffect(() => {
    const img = imgRef.current;
    img.crossOrigin = "anonymous";
    img.onload = () => render();
    img.src = sliceUrl;
  }, [sliceUrl]);

  useEffect(() => { render(); }, [wc,ww,zoom,pan,crosshair,annotations,sliceIndex]);

  function render() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0,0,W,H);
    ctx.fillStyle = "#000"; ctx.fillRect(0,0,W,H);

    const img = imgRef.current;
    if (img.complete && img.naturalWidth) {
      const sw=W*zoom, sh=H*zoom;
      ctx.drawImage(img, (W-sw)/2+pan.x, (H-sh)/2+pan.y, sw, sh);
    }

    // Crosshair
    if (crosshair) {
      const cx=crosshair.x*W, cy=crosshair.y*H;
      ctx.strokeStyle=AXIS_COLORS[axis]+"88"; ctx.lineWidth=1; ctx.setLineDash([4,4]);
      ctx.beginPath(); ctx.moveTo(cx,0); ctx.lineTo(cx,H); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0,cy); ctx.lineTo(W,cy); ctx.stroke();
      ctx.setLineDash([]);
    }

    // Annotations
    const axisAnns = annotations.filter(a=>a.axis===axis);
    for (const ann of axisAnns) {
      if (ann.type==="measure") {
        const p1={x:ann.p1.x*W,y:ann.p1.y*H}, p2={x:ann.p2.x*W,y:ann.p2.y*H};
        ctx.strokeStyle="#fde68a"; ctx.lineWidth=1.5;
        ctx.beginPath(); ctx.moveTo(p1.x,p1.y); ctx.lineTo(p2.x,p2.y); ctx.stroke();
        [p1,p2].forEach(p=>{ctx.fillStyle="#fde68a";ctx.beginPath();ctx.arc(p.x,p.y,3,0,2*Math.PI);ctx.fill();});
        ctx.font="11px monospace"; ctx.fillStyle="#fde68a";
        ctx.fillText(`${ann.mm.toFixed(1)} mm`,(p1.x+p2.x)/2+4,(p1.y+p2.y)/2-4);
      }
      if (ann.type==="angle") {
        const pts=ann.points.map(p=>({x:p.x*W,y:p.y*H}));
        ctx.strokeStyle="#86efac"; ctx.lineWidth=1.5;
        ctx.beginPath(); ctx.moveTo(pts[0].x,pts[0].y); ctx.lineTo(pts[1].x,pts[1].y); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(pts[1].x,pts[1].y); ctx.lineTo(pts[2].x,pts[2].y); ctx.stroke();
        ctx.font="11px monospace"; ctx.fillStyle="#86efac";
        ctx.fillText(`${ann.deg.toFixed(1)}°`,pts[1].x+6,pts[1].y-6);
      }
      if (ann.type==="implant") {
        const cx=ann.cx*W, cy=ann.cy*H;
        const r=(ann.diameter/2)*zoom*10, h=ann.length*zoom*10;
        ctx.strokeStyle="#60a5fa"; ctx.lineWidth=2;
        ctx.beginPath(); ctx.ellipse(cx,cy,r,h/2,(ann.angleDeg||0)*Math.PI/180,0,2*Math.PI); ctx.stroke();
        ctx.fillStyle="#60a5fa33"; ctx.fill();
        ctx.font="10px monospace"; ctx.fillStyle="#60a5fa";
        ctx.fillText(`Ø${ann.diameter}×${ann.length}mm`,cx+r+4,cy);
      }
      if (ann.type==="nerve") {
        const pts=ann.points.map(p=>({x:p.x*W,y:p.y*H}));
        ctx.strokeStyle="#f9a8d4"; ctx.lineWidth=2; ctx.setLineDash([3,2]);
        ctx.beginPath();
        pts.forEach((p,i)=>i===0?ctx.moveTo(p.x,p.y):ctx.lineTo(p.x,p.y));
        ctx.stroke(); ctx.setLineDash([]);
      }
    }

    // HUD
    ctx.fillStyle=AXIS_COLORS[axis]; ctx.font="bold 11px monospace";
    ctx.fillText(AXIS_LABELS[axis].toUpperCase(),8,20);
    ctx.fillStyle="#fff8"; ctx.font="10px monospace";
    ctx.fillText(`${sliceIndex+1}/${totalSlices}`,8,36);
    ctx.fillText(`WC:${wc} WW:${ww}`,8,52);
  }

  function canvasPos(e) {
    const r=canvasRef.current.getBoundingClientRect();
    return { x:clamp((e.clientX-r.left)/r.width,0,1), y:clamp((e.clientY-r.top)/r.height,0,1) };
  }

  function onMouseDown(e) {
    onActivate(); e.preventDefault();
    const pos=canvasPos(e);
    dragRef.current={lastPos:pos, startPan:{...pan}};

    if (tool==="measure") {
      if (annPts.current.length===0) { annPts.current=[pos]; }
      else {
        const p1=annPts.current[0];
        const mm=dist2D(p1,pos)*200;
        onAnnotationAdd({type:"measure",axis,p1,p2:pos,mm});
        annPts.current=[];
      }
      render(); return;
    }
    if (tool==="angle") {
      annPts.current.push(pos);
      if (annPts.current.length===3) {
        const [a,b,c]=annPts.current;
        onAnnotationAdd({type:"angle",axis,points:[a,b,c],deg:angleDeg(a,b,c)});
        annPts.current=[];
      }
      render(); return;
    }
    if (tool==="nerve") { annPts.current.push(pos); render(); return; }
    if (tool==="probe") { onAnnotationAdd({type:"probe",axis,x:pos.x,y:pos.y,hu:"~"+Math.round(wc)}); }
  }

  function onMouseMove(e) {
    const d=dragRef.current;
    if (!d||!e.buttons) return;
    const pos=canvasPos(e), dx=pos.x-d.lastPos.x, dy=pos.y-d.lastPos.y;
    d.lastPos=pos;
    if (tool==="pan"||e.buttons===4) {
      const c=canvasRef.current;
      onPanChange({x:pan.x+dx*c.width,y:pan.y+dy*c.height}); return;
    }
    if (tool==="window") { onWindowChange(clamp(wc+dy*800,-2000,4000),clamp(ww+dx*800,1,8000)); return; }
    onCrosshairChange(pos); render();
  }

  function onMouseUp(e) {
    if (tool==="implant") onAnnotationAdd({type:"implant_request",axis,...canvasPos(e)});
    dragRef.current=null;
  }

  function onWheel(e) {
    e.preventDefault();
    if (e.ctrlKey) onZoomChange(clamp(zoom*(e.deltaY>0?0.9:1.1),0.3,8));
    else onSliceChange(clamp(sliceIndex+(e.deltaY>0?1:-1),0,totalSlices-1));
  }

  function onDoubleClick() {
    if (tool==="nerve"&&annPts.current.length>1) {
      onAnnotationAdd({type:"nerve",axis,points:[...annPts.current]});
      annPts.current=[]; render();
    }
  }

  return (
    <div style={{ position:"relative",border:active?`2px solid ${AXIS_COLORS[axis]}`:"2px solid #1e293b",
      borderRadius:6,overflow:"hidden",flex:"1 1 0",minWidth:240,background:"#000",
      cursor:tool==="pan"?"grab":tool==="window"?"ew-resize":"crosshair" }}>
      <canvas ref={canvasRef} width={380} height={380}
        style={{ display:"block",width:"100%",height:"100%" }}
        onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp}
        onWheel={onWheel} onDoubleClick={onDoubleClick}
        onContextMenu={e=>e.preventDefault()} />
      <input type="range" min={0} max={totalSlices-1} value={sliceIndex}
        onChange={e=>onSliceChange(Number(e.target.value))}
        style={{ position:"absolute",bottom:6,left:8,right:8,width:"calc(100% - 16px)",
          accentColor:AXIS_COLORS[axis],opacity:0.7 }} />
    </div>
  );
}

/* ═══════════════════════════════════════════
   IMPLANT DIALOG
═══════════════════════════════════════════ */
function ImplantDialog({ req, onConfirm, onCancel }) {
  const [sys,      setSys]      = useState(0);
  const [length,   setLength]   = useState(10);
  const [diameter, setDiameter] = useState(4.0);
  const [angle,    setAngle]    = useState(0);
  const s = IMPLANT_SYSTEMS[sys];

  const inp = { width:"100%",padding:"7px 10px",border:"1px solid #334155",borderRadius:7,
    background:"#1e293b",color:"#e2e8f0",fontSize:12,fontFamily:"'DM Mono',monospace" };

  return (
    <div style={{ position:"absolute",inset:0,background:"#00000099",
      display:"flex",alignItems:"center",justifyContent:"center",zIndex:100 }}>
      <div style={{ background:"#0f172a",border:"1px solid #334155",borderRadius:12,
        padding:24,minWidth:260,boxShadow:"0 20px 60px #0008" }}>
        <h3 style={{ color:"#60a5fa",margin:"0 0 14px",fontFamily:"'DM Mono',monospace",fontSize:14 }}>
          🦷 Place Implant
        </h3>
        {[
          ["System", <select style={inp} value={sys} onChange={e=>setSys(+e.target.value)}>
            {IMPLANT_SYSTEMS.map((s,i)=><option key={i} value={i}>{s.brand}</option>)}</select>],
          ["Length (mm)", <select style={inp} value={length} onChange={e=>setLength(+e.target.value)}>
            {s.lengths.map(l=><option key={l} value={l}>{l} mm</option>)}</select>],
          ["Diameter (mm)", <select style={inp} value={diameter} onChange={e=>setDiameter(+e.target.value)}>
            {s.diameters.map(d=><option key={d} value={d}>{d} mm</option>)}</select>],
        ].map(([label,el])=>(
          <div key={label} style={{ marginBottom:10 }}>
            <div style={{ fontSize:10,color:"#64748b",marginBottom:4,fontFamily:"'DM Mono',monospace",textTransform:"uppercase" }}>{label}</div>
            {el}
          </div>
        ))}
        <div style={{ marginBottom:14 }}>
          <div style={{ fontSize:10,color:"#64748b",marginBottom:4,fontFamily:"'DM Mono',monospace",textTransform:"uppercase" }}>Angle: {angle}°</div>
          <input type="range" min={-45} max={45} value={angle} onChange={e=>setAngle(+e.target.value)}
            style={{ width:"100%",accentColor:"#60a5fa" }} />
        </div>
        <div style={{ display:"flex",gap:8 }}>
          <button style={{ flex:1,background:"#1d4ed8",color:"#fff",border:"none",borderRadius:7,
            padding:"8px 0",cursor:"pointer",fontSize:12,fontFamily:"'DM Mono',monospace" }}
            onClick={()=>onConfirm({...req,brand:s.brand,length,diameter,angleDeg:angle})}>Place</button>
          <button style={{ flex:1,background:"#1e293b",color:"#94a3b8",border:"1px solid #334155",
            borderRadius:7,padding:"8px 0",cursor:"pointer",fontSize:12,fontFamily:"'DM Mono',monospace" }}
            onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   CBCT VIEWER  (full-screen overlay)
═══════════════════════════════════════════ */
function CBCTViewer({ volumeId, onClose }) {
  const [meta,        setMeta]        = useState(null);
  const [loading,     setLoading]     = useState(true);
  const [tool,        setTool]        = useState("pan");
  const [wc,          setWc]          = useState(400);
  const [ww,          setWw]          = useState(3000);
  const [zoom,        setZoom]        = useState(1);
  const [pans,        setPans]        = useState({axial:{x:0,y:0},coronal:{x:0,y:0},sagittal:{x:0,y:0}});
  const [activeAxis,  setActiveAxis]  = useState("axial");
  const [layout,      setLayout]      = useState("3up");
  const [annotations, setAnnotations] = useState([]);
  const [implantReq,  setImplantReq]  = useState(null);
  const [saved,       setSaved]       = useState(false);
  const [showInfo,    setShowInfo]    = useState(false);
  const [crosshair,   setCrosshair]   = useState({axial:{x:.5,y:.5},coronal:{x:.5,y:.5},sagittal:{x:.5,y:.5}});
  const [slices,      setSlices]      = useState({axial:0,coronal:0,sagittal:0});

  const dims = meta ? {
    axial:    meta.dimensions.axial    || 100,
    coronal:  meta.dimensions.coronal  || 100,
    sagittal: meta.dimensions.sagittal || 100,
  } : {axial:100,coronal:100,sagittal:100};

  useEffect(() => {
    fetch(`${CBCT_API}/cbct/${volumeId}/meta`, {
      headers: { Authorization: `Bearer ${localStorage.getItem("token")||""}` }
    }).then(r=>r.json()).then(d=>{setMeta(d);setLoading(false);}).catch(()=>setLoading(false));

    fetch(`${CBCT_API}/cbct/${volumeId}/annotations`, {
      headers: { Authorization: `Bearer ${localStorage.getItem("token")||""}` }
    }).then(r=>r.json()).then(d=>{
      setAnnotations([...(d.measurements||[]),(d.implants||[]),(d.nerves||[]),(d.texts||[])].flat());
    }).catch(()=>{});
  }, [volumeId]);

  const saveAnnotations = async () => {
    const body = {
      measurements: annotations.filter(a=>a.type==="measure"||a.type==="angle"),
      implants:     annotations.filter(a=>a.type==="implant"),
      nerves:       annotations.filter(a=>a.type==="nerve"),
      texts:        annotations.filter(a=>a.type==="text"),
    };
    await fetch(`${CBCT_API}/cbct/${volumeId}/annotations`, {
      method:"PUT",
      headers:{ "Content-Type":"application/json", Authorization:`Bearer ${localStorage.getItem("token")||""}` },
      body:JSON.stringify(body),
    });
    setSaved(true); setTimeout(()=>setSaved(false),2000);
  };

  const handleAnnotationAdd = useCallback((ann) => {
    if (ann.type==="implant_request") { setImplantReq(ann); return; }
    setAnnotations(prev=>[...prev,{...ann,id:Date.now()}]);
  },[]);

  const handleCrosshair = useCallback((axis,pos) => {
    setCrosshair(prev=>({...prev,[axis]:pos}));
    if (axis==="axial") setSlices(prev=>({...prev,coronal:Math.round(pos.y*dims.coronal),sagittal:Math.round(pos.x*dims.sagittal)}));
    if (axis==="coronal") setSlices(prev=>({...prev,axial:Math.round(pos.y*dims.axial),sagittal:Math.round(pos.x*dims.sagittal)}));
    if (axis==="sagittal") setSlices(prev=>({...prev,axial:Math.round(pos.y*dims.axial),coronal:Math.round(pos.x*dims.coronal)}));
  },[dims]);

  const resetView = ()=>{setWc(400);setWw(3000);setZoom(1);setPans({axial:{x:0,y:0},coronal:{x:0,y:0},sagittal:{x:0,y:0}});setSlices({axial:0,coronal:0,sagittal:0});};

  const exportJSON = ()=>{
    const a=document.createElement("a");
    a.href=URL.createObjectURL(new Blob([JSON.stringify(annotations,null,2)],{type:"application/json"}));
    a.download=`cbct_${volumeId}_annotations.json`; a.click();
  };

  const visibleAxes = layout==="3up" ? ["axial","coronal","sagittal"] : [layout];

  if (loading) return (
    <div className="cbct-viewer-root" style={{ alignItems:"center",justifyContent:"center" }}>
      <div className="imgup-spinner" style={{ width:28,height:28,borderColor:"#1e293b",borderTopColor:"#22d3ee" }}/>
      <span style={{ color:"#60a5fa",fontSize:14,marginTop:12,fontFamily:"'DM Mono',monospace" }}>Loading CBCT volume…</span>
    </div>
  );

  return (
    <div className="cbct-viewer-root">
      {/* Top bar */}
      <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",
        padding:"7px 14px",background:"#0f172a",borderBottom:"1px solid #1e293b",flexShrink:0,gap:10 }}>
        <div style={{ display:"flex",alignItems:"center",gap:10 }}>
          <span style={{ color:"#60a5fa",fontWeight:700,fontSize:13,whiteSpace:"nowrap" }}>🔬 CBCT Viewer</span>
          {meta && (
            <span style={{ background:"#1e293b",color:"#94a3b8",fontSize:10,padding:"3px 10px",
              borderRadius:10,whiteSpace:"nowrap" }}>
              {meta.patient_name} · {meta.dimensions?.axial||"?"} slices
              {meta.study_date && ` · ${meta.study_date}`}
            </span>
          )}
        </div>
        {/* Layout buttons */}
        <div style={{ display:"flex",gap:4 }}>
          {["3up","axial","coronal","sagittal"].map(l=>(
            <button key={l} className={`cbct-layout-btn ${layout===l?"active":""}`} onClick={()=>setLayout(l)}>
              {l==="3up"?"⊞":l==="axial"?"Ax":l==="coronal"?"Co":"Sa"}
            </button>
          ))}
        </div>
        <div style={{ display:"flex",gap:4,alignItems:"center" }}>
          <button className="cbct-icon-btn" onClick={resetView} title="Reset">↺</button>
          <button className="cbct-icon-btn" onClick={exportJSON} title="Export annotations">💾</button>
          <button className="cbct-icon-btn" onClick={saveAnnotations} title="Save to server">
            {saved?"✅":"🔒"}
          </button>
          <button className="cbct-icon-btn" onClick={()=>setShowInfo(p=>!p)} title="Info">ℹ️</button>
          <button className="cbct-icon-btn" onClick={onClose}
            title="Close" style={{ color:"#f87171" }}>✕</button>
        </div>
      </div>

      {/* Main */}
      <div style={{ display:"flex",flex:1,overflow:"hidden" }}>
        {/* Toolbar */}
        <div style={{ width:130,flexShrink:0,background:"#0f172a",borderRight:"1px solid #1e293b",
          overflowY:"auto",display:"flex",flexDirection:"column",padding:"8px 4px",gap:2 }}>

          {/* Tools */}
          {TOOLS.map(t=>(
            <button key={t.id} className={`cbct-toolbar-btn ${tool===t.id?"active":""}`}
              onClick={()=>setTool(t.id)} title={t.label}>
              <span style={{ fontSize:17 }}>{t.icon}</span>
              <span style={{ fontSize:9,marginTop:1,opacity:0.7 }}>{t.label.split("/")[0].trim()}</span>
            </button>
          ))}

          <div style={{ height:1,background:"#1e293b",margin:"8px 4px" }}/>

          {/* Presets */}
          <div style={{ fontSize:9,color:"#475569",padding:"0 2px",marginBottom:3,letterSpacing:1 }}>PRESETS</div>
          {WINDOW_PRESETS.map(p=>(
            <button key={p.label} className="cbct-preset-btn"
              onClick={()=>{setWc(p.wc);setWw(p.ww);}}>
              {p.label}
            </button>
          ))}

          <div style={{ height:1,background:"#1e293b",margin:"8px 4px" }}/>

          {/* WW/WC sliders */}
          <div style={{ fontSize:9,color:"#475569",padding:"0 2px",marginBottom:3,letterSpacing:1 }}>WINDOW</div>
          {[["WC",wc,-2000,4000,setWc,"#22d3ee"],["WW",ww,1,8000,setWw,"#22d3ee"],["Zoom",Math.round(zoom*100),30,800,v=>setZoom(v/100),"#a78bfa"]].map(([label,val,lo,hi,setter,color])=>(
            <div key={label} style={{ marginBottom:6 }}>
              <div style={{ display:"flex",justifyContent:"space-between",fontSize:9,color:"#64748b" }}>
                <span>{label}</span><span style={{ color:"#94a3b8" }}>{val}{label==="Zoom"?"%":""}</span>
              </div>
              <input type="range" min={lo} max={hi} value={val}
                onChange={e=>setter(+e.target.value)}
                style={{ width:"100%",accentColor:color }} />
            </div>
          ))}

          <div style={{ height:1,background:"#1e293b",margin:"8px 4px" }}/>

          {/* Annotations list */}
          <div style={{ fontSize:9,color:"#475569",padding:"0 2px",marginBottom:3,letterSpacing:1 }}>ANNOTATIONS ({annotations.length})</div>
          {annotations.slice(-6).map((a,i)=>(
            <div key={a.id||i} style={{ display:"flex",justifyContent:"space-between",alignItems:"center",
              padding:"2px 2px",borderBottom:"1px solid #0f172a" }}>
              <span style={{ fontSize:9,color:"#64748b",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>
                {a.type==="measure"?`📏 ${a.mm?.toFixed(1)}mm`:
                 a.type==="angle"?`📐 ${a.deg?.toFixed(1)}°`:
                 a.type==="implant"?`🦷 Ø${a.diameter}×${a.length}`:
                 a.type==="nerve"?"🧠 IAN":a.type}
              </span>
              <button style={{ background:"transparent",border:"none",color:"#475569",cursor:"pointer",fontSize:9,padding:"0 2px" }}
                onClick={()=>setAnnotations(prev=>prev.filter((_,j)=>j!==annotations.length-6+i))}>✕</button>
            </div>
          ))}
          {annotations.length===0 && <div style={{ fontSize:9,color:"#334155",padding:"2px" }}>No annotations</div>}

          {/* Implants summary */}
          {annotations.filter(a=>a.type==="implant").length>0 && (
            <>
              <div style={{ height:1,background:"#1e293b",margin:"8px 4px" }}/>
              <div style={{ fontSize:9,color:"#475569",padding:"0 2px",marginBottom:3,letterSpacing:1 }}>IMPLANTS</div>
              {annotations.filter(a=>a.type==="implant").map((imp,i)=>(
                <div key={i} style={{ fontSize:9,color:"#93c5fd",padding:"2px 2px",lineHeight:1.5 }}>
                  #{i+1} {imp.brand}<br/>Ø{imp.diameter}×{imp.length}mm @ {imp.angleDeg}°
                </div>
              ))}
            </>
          )}
        </div>

        {/* Viewports */}
        <div style={{ flex:1,display:"flex",gap:4,padding:4,overflow:"hidden",
          flexDirection:layout==="3up"?"row":"column" }}>
          {visibleAxes.map(axis=>(
            <SlicePanel key={axis} axis={axis} volumeId={volumeId}
              sliceIndex={slices[axis]} totalSlices={dims[axis]}
              wc={wc} ww={ww} tool={tool} zoom={zoom} pan={pans[axis]}
              crosshair={crosshair[axis]}
              onCrosshairChange={pos=>handleCrosshair(axis,pos)}
              annotations={annotations}
              onAnnotationAdd={handleAnnotationAdd}
              onSliceChange={idx=>setSlices(prev=>({...prev,[axis]:idx}))}
              onWindowChange={(wc,ww)=>{setWc(Math.round(wc));setWw(Math.round(ww));}}
              onPanChange={np=>setPans(prev=>({...prev,[axis]:np}))}
              onZoomChange={setZoom}
              active={activeAxis===axis}
              onActivate={()=>setActiveAxis(axis)}
            />
          ))}
        </div>
      </div>

      {/* Status bar */}
      <div style={{ display:"flex",gap:20,padding:"5px 14px",background:"#0f172a",
        borderTop:"1px solid #1e293b",fontSize:10,color:"#475569",flexShrink:0,flexWrap:"wrap" }}>
        <span>Tool: <b style={{ color:"#22d3ee" }}>{TOOLS.find(t=>t.id===tool)?.label}</b></span>
        <span>Ax {slices.axial+1}/{dims.axial} · Co {slices.coronal+1}/{dims.coronal} · Sa {slices.sagittal+1}/{dims.sagittal}</span>
        <span>WC:{wc} WW:{ww} · Zoom:{Math.round(zoom*100)}%</span>
        <span style={{ opacity:.4 }}>Scroll=slice · Ctrl+Scroll=zoom · Drag(window tool)=W/L · Dbl-click=finish nerve</span>
      </div>

      {/* Info panel */}
      {showInfo && meta && (
        <div style={{ position:"absolute",top:46,right:14,width:280,background:"#0f172a",
          border:"1px solid #334155",borderRadius:10,padding:18,zIndex:50,
          boxShadow:"0 20px 60px #0008",fontFamily:"'DM Mono',monospace" }}>
          <button className="cbct-icon-btn" onClick={()=>setShowInfo(false)}
            style={{ position:"absolute",top:8,right:8 }}>✕</button>
          <div style={{ color:"#60a5fa",fontWeight:700,fontSize:13,marginBottom:12 }}>Volume Info</div>
          {[["Patient",meta.patient_name],["Study Date",meta.study_date],
            ["Axial",meta.dimensions?.axial+" slices"],["Coronal",meta.dimensions?.coronal+" slices"],
            ["Sagittal",meta.dimensions?.sagittal+" slices"],
            ["Voxel",`${meta.voxel_spacing?.x?.toFixed(3)} × ${meta.voxel_spacing?.y?.toFixed(3)} × ${meta.voxel_spacing?.z?.toFixed(3)} mm`],
            ["Uploaded",meta.uploaded_at]].filter(([,v])=>v).map(([k,v])=>(
            <div key={k} style={{ display:"flex",gap:8,marginBottom:5 }}>
              <span style={{ color:"#64748b",fontSize:10,width:72,flexShrink:0 }}>{k}</span>
              <span style={{ color:"#e2e8f0",fontSize:10 }}>{v}</span>
            </div>
          ))}
          <div style={{ marginTop:12,paddingTop:10,borderTop:"1px solid #1e293b",
            fontSize:9,color:"#fbbf24",lineHeight:1.6 }}>
            ⚠ Always verify IAN canal with clinical judgment. Maintain ≥2 mm safety margin from nerve canal.
          </div>
        </div>
      )}

      {/* Implant dialog */}
      {implantReq && (
        <ImplantDialog req={implantReq}
          onConfirm={imp=>{setAnnotations(prev=>[...prev,{...imp,type:"implant",id:Date.now()}]);setImplantReq(null);}}
          onCancel={()=>setImplantReq(null)} />
      )}
    </div>
  );
}
function CBCTUploadSection({ visitId, disabled }) {
  const [volumes, setVolumes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [uploadMsg, setUploadMsg] = useState("");
  const [error, setError] = useState(null);
  const [dragOver, setDragOver] = useState(false);

  const fileRef = useRef(null);
  const folderRef = useRef(null);

  const loadVolumes = useCallback(() => {
    setLoading(true);
    api.get(`/visits/${visitId}/cbct`)
      .then(r => {
        const data = r.data;
        const list = Array.isArray(data)
          ? data
          : Array.isArray(data?.cbct_files)
            ? data.cbct_files
            : [];
        setVolumes(list);
        setLoading(false);
      })
      .catch(() => {
        setError("Failed to load CBCT volumes");
        setLoading(false);
      });
  }, [visitId]);

  useEffect(() => {
    loadVolumes();
  }, [loadVolumes]);

  const createZipFromFiles = async (files) => {
    const JSZip = window.JSZip || (await import("jszip")).default;
    const zip = new JSZip();

    for (const file of files) {
      const path = file.webkitRelativePath || file.name;
      zip.file(path, file);
    }

    return await zip.generateAsync({ type: "blob" });
  };

  const doUpload = useCallback(async (fileOrFiles) => {
    if (!fileOrFiles) return;

    setError(null);
    setUploading(true);
    setUploadPct(5);
    setUploadMsg("Preparing files…");

    try {
      let zipBlob;

      if (fileOrFiles instanceof FileList) {
        setUploadMsg("Creating ZIP from folder…");
        const files = Array.from(fileOrFiles);

        const dicomFiles = files.filter(f => {
          const name = f.name.toLowerCase();
          return !name.startsWith(".") &&
            (name.endsWith(".dcm") || !name.includes("."));
        });

        if (dicomFiles.length === 0) {
          throw new Error("No DICOM files found in folder");
        }

        zipBlob = await createZipFromFiles(dicomFiles);
      } else {
        if (!fileOrFiles.name.toLowerCase().endsWith(".zip")) {
          setError("Please select a .zip file or DICOM folder.");
          setUploading(false);
          return;
        }
        zipBlob = fileOrFiles;
      }

      const fd = new FormData();
      fd.append("file", zipBlob, "cbct.zip");
      fd.append("uploaded_by", "USER");

      const res = await api.post(`/visits/${visitId}/cbct`, fd, {
        headers: { "Content-Type": "multipart/form-data" }
      });

      setUploadPct(100);
      setUploadMsg(`✅ Done! ${res.data.num_slices} slices processed.`);

      setTimeout(() => {
        setUploading(false);
        setUploadPct(0);
        setUploadMsg("");
        loadVolumes();
      }, 1500);

    } catch (e) {
      setError(e?.message || "Upload failed");
      setUploading(false);
      setUploadPct(0);
    }
  }, [visitId, loadVolumes]);

  const deleteVolume = async (id) => {
    if (!window.confirm("Delete this CBCT volume?")) return;
    await api.delete(`/cbct/${id}`);
    loadVolumes();
  };

  const openCBCTInNewTab = (id) => {
    localStorage.setItem("cbct_viewer_params", JSON.stringify({ volumeId: id, apiBase: CBCT_API }));
    window.open(`/cbct-viewer?volumeId=${id}`, "_blank", "noopener");
  };

  return (
    <div style={{ marginTop: 4 }}>

      {!disabled && (
        <div
          className={`cbct-drop-zone ${dragOver ? "drag-over" : ""}`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);

            const files = e.dataTransfer.files;

            if (files.length > 1) doUpload(files);
            else doUpload(files[0]);
          }}
        >

          <input
            ref={fileRef}
            type="file"
            accept=".zip"
            style={{ display: "none" }}
            onChange={(e) => doUpload(e.target.files[0])}
          />

          <input
            ref={folderRef}
            type="file"
            multiple
            {...{ webkitdirectory: "", directory: "" }}
            style={{ display: "none" }}
            onChange={(e) => doUpload(e.target.files)}
          />

          {uploading ? (
            <div>{uploadMsg}</div>
          ) : (
            <>
              <button onClick={() => folderRef.current.click()}>
                📁 Folder
              </button>
              <button onClick={() => fileRef.current.click()}>
                🗜️ ZIP
              </button>
            </>
          )}

        </div>
      )}

      {error && (
        <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",
          background:"#450a0a",border:"1px solid #7f1d1d",borderRadius:8,
          padding:"10px 14px",color:"#fca5a5",fontSize:13,marginTop:10 }}>
          <span>⚠️ {error}</span>
          <button onClick={()=>setError(null)} style={{ background:"transparent",border:"none",
            color:"#fca5a5",cursor:"pointer",fontSize:16,padding:0 }}>✕</button>
        </div>
      )}

      <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:14,marginBottom:8 }}>
        <span style={{ fontSize:13,fontWeight:700,color:"#0b2d4e" }}>
          CBCT Volumes {!loading && `(${volumes.length})`}
        </span>
        <button onClick={loadVolumes} style={{ background:"transparent",border:"1.5px solid #e2e8f4",
          color:"#64748b",padding:"4px 10px",borderRadius:6,fontSize:12,cursor:"pointer" }}>
          ↺ Refresh
        </button>
      </div>

      {loading ? (
        <div style={{ textAlign:"center",padding:"24px 0",color:"#94a3b8",fontSize:13 }}>
          <span className="imgup-spinner" style={{ marginRight:8 }}/>Loading volumes…
        </div>
      ) : volumes.length === 0 ? (
        <div style={{ textAlign:"center",padding:"24px 0",color:"#94a3b8",fontSize:13 }}>
          No CBCT volumes yet. Upload a ZIP or folder above.
        </div>
      ) : (
        <div style={{ display:"flex",flexDirection:"column",gap:8 }}>
          {volumes.map(v => (
            <div key={v.id} className="cbct-vol-card">
              <div style={{ fontSize:26,flexShrink:0 }}>🦷</div>
              <div style={{ flex:1,minWidth:0 }}>
                <div style={{ fontSize:13,fontWeight:700,color:"#e2e8f0",
                  display:"flex",alignItems:"center",gap:8,marginBottom:4 }}>
                  {v.patient_name || "CBCT Volume"}
                  {v.num_slices && (
                    <span style={{ background:"#1d4ed8",color:"#93c5fd",fontSize:10,
                      padding:"2px 8px",borderRadius:10 }}>
                      {v.num_slices} slices
                    </span>
                  )}
                </div>
                <div style={{ display:"flex",gap:6,flexWrap:"wrap",color:"#64748b",fontSize:11 }}>
                  {v.study_date && <span>📅 {v.study_date}</span>}
                  {v.dimensions?.rows && <span>· {v.dimensions.rows}×{v.dimensions.cols}px</span>}
                  {v.uploaded_at && <span>· ⬆ {v.uploaded_at}</span>}
                </div>
              </div>
              <div style={{ display:"flex",gap:8,flexShrink:0 }}>
                <button className="cbct-open-btn" onClick={() => openCBCTInNewTab(v.id)}>
                  🖥️ View CBCT
                </button>
                <button onClick={() => deleteVolume(v.id)}
                  style={{ background:"transparent",border:"1.5px solid #1e293b",
                    color:"#64748b",borderRadius:8,padding:"8px 10px",
                    fontSize:14,cursor:"pointer" }}>
                  🗑️
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

    </div>
  );
}

/* ═══════════════════════════════════════════
   MAIN COMPONENT
═══════════════════════════════════════════ */
export default function ImageUpload({ visitId, disabled = false }) {
  useEffect(() => { injectStyles(); }, []);

  const [activeTab,   setActiveTab]   = useState("images"); // "images" | "cbct"
  const [images,      setImages]      = useState([]);
  const [loadingImgs, setLoadingImgs] = useState(false);
  const [loadError,   setLoadError]   = useState("");
  const [showUpload,  setShowUpload]  = useState(false);
  const [lightbox,    setLightbox]    = useState(null);
  const [editImg,     setEditImg]     = useState(null);
  const [deleteImg,   setDeleteImg]   = useState(null);

  useEffect(() => { if (visitId) loadImages(true); }, [visitId]);

  // Leaving the page: free the pictures held in memory.
  useEffect(() => () => forgetAllPictures(), []);

  const loadImages = async (showSpinner = false) => {
    if (showSpinner) setLoadingImgs(true);
    setLoadError("");
    try {
      const res = await api.get(`/visits/${visitId}/images`);
      setImages(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      console.error("Failed to load images", err);
      setLoadError("Could not load the pictures for this visit.");
    }
    finally { setLoadingImgs(false); }
  };

  // Gallery: X-rays and photos, grouped by kind. A plain picture saved with the
  // kind "CBCT" (for example a screenshot of a slice) is shown here too; full
  // CBCT scans live in the "CBCT Volumes" tab.
  const grouped = IMAGE_TYPES.reduce((acc,t) => {
    const group = images.filter(img=>img.type===t.value);
    if (group.length>0) acc.push({...t,label:t.value==="CBCT"?"CBCT (pictures)":t.label,images:group});
    return acc;
  },[]);
  const known = new Set(IMAGE_TYPES.map(t => t.value));
  const others = images.filter(img => !known.has(img.type));
  if (others.length > 0) grouped.push({ value:"OTHER", label:"Other", icon:"📄", images:others });
  const ordered = grouped.flatMap(g => g.images);            // same order as on screen, for ← → in the viewer

  // Keep the viewer on the same picture if the list is refreshed underneath it.
  const viewing = lightbox ? (ordered.find(i => i.id === lightbox.id) || null) : null;

  return (
    <div className="imgup-root">

      {/* ── Header ── */}
      <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,flexWrap:"wrap",marginBottom:14 }}>
        <div style={{ display:"flex",alignItems:"center",gap:10 }}>
          <div style={{ width:36,height:36,borderRadius:9,
            background:"linear-gradient(135deg,#dbeafe,#bfdbfe)",
            display:"flex",alignItems:"center",justifyContent:"center",fontSize:18 }}>🖼️</div>
          <div>
            <div style={{ fontSize:14,fontWeight:700,color:"#0b2d4e" }}>Clinical Images</div>
            <div style={{ fontSize:11.5,color:"#94a3b8" }}>
              {images.length} image{images.length!==1?"s":""} · IOPA · OPG · CBCT · Intraoral
            </div>
          </div>
        </div>
        {!disabled && activeTab==="images" && (
          <button type="button" onClick={()=>setShowUpload(true)} style={{
            display:"inline-flex",alignItems:"center",gap:8,
            padding:"10px 20px",borderRadius:10,
            background:"linear-gradient(135deg,#1d4d7a,#1d6fa4)",
            color:"#fff",border:"none",
            fontFamily:"'Plus Jakarta Sans',sans-serif",
            fontSize:13,fontWeight:700,cursor:"pointer",
            boxShadow:"0 4px 12px rgba(29,77,122,0.28)" }}>
            <span style={{ fontSize:16 }}>+</span> Upload Image
          </button>
        )}
      </div>

      {/* ── Tab bar ── */}
      <div style={{ display:"flex",gap:8,marginBottom:16,
        borderBottom:"2px solid #e8eef8",paddingBottom:10 }}>
        <button type="button" className={`cbct-tab-btn ${activeTab==="images"?"active":""}`}
          onClick={()=>setActiveTab("images")}>
          🖼️ X-Rays & Photos
        </button>
        <button type="button" className={`cbct-tab-btn ${activeTab==="cbct"?"active":""}`}
          onClick={()=>setActiveTab("cbct")}>
          🔬 CBCT Volumes
        </button>
      </div>

      {/* ── Images Tab ── */}
      {activeTab==="images" && (
        <>
          {loadError && (
            <div role="alert" style={{ display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,flexWrap:"wrap",
              background:"#fef2f2",border:"1px solid #fecaca",borderRadius:9,padding:"9px 12px",
              color:"#b91c1c",fontSize:12.5,fontWeight:600,marginBottom:12 }}>
              <span>⚠️ {loadError}</span>
              <button type="button" onClick={()=>loadImages(true)} style={{ background:"#fff",border:"1px solid currentColor",color:"inherit",
                borderRadius:6,padding:"3px 10px",fontSize:12,fontWeight:600,cursor:"pointer" }}>Try again</button>
            </div>
          )}
          {loadingImgs && (
            <div style={{ textAlign:"center",padding:"28px 0",color:"#94a3b8",fontSize:13 }}>
              <span className="imgup-spinner" style={{ marginRight:8 }}/>Loading images…
            </div>
          )}
          {!loadingImgs && !loadError && images.length===0 && (
            <div style={{ textAlign:"center",padding:"40px 20px",background:"#fafbff",
              borderRadius:12,border:"1.5px dashed #dde8f8" }}>
              <div style={{ fontSize:40,marginBottom:10 }}>🦷</div>
              <div style={{ fontSize:14,fontWeight:600,color:"#475569",marginBottom:6 }}>No clinical images yet</div>
              <div style={{ fontSize:12.5,color:"#94a3b8",marginBottom:16 }}>
                {disabled ? "No pictures were added for this visit" : "Upload X-rays, OPGs or intraoral photos"}
              </div>
              {!disabled && (
                <button type="button" onClick={()=>setShowUpload(true)} style={{
                  padding:"10px 22px",borderRadius:10,
                  background:"linear-gradient(135deg,#1d4d7a,#1d6fa4)",
                  color:"#fff",border:"none",fontFamily:"'Plus Jakarta Sans',sans-serif",
                  fontSize:13,fontWeight:700,cursor:"pointer" }}>
                  + Upload First Image
                </button>
              )}
            </div>
          )}
          {!loadingImgs && grouped.map(group=>(
            <div key={group.value}>
              <div className="imgup-section-hd">
                <span style={{ fontSize:16 }}>{group.icon}</span>
                {group.label}
                <span style={{ marginLeft:"auto",fontSize:10,fontWeight:700,
                  background:"#dbeafe",color:"#1d4ed8",borderRadius:20,padding:"1px 9px" }}>
                  {group.images.length}
                </span>
              </div>
              <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))",gap:12,marginBottom:8 }}>
                {group.images.map(img=>(
                  <ImageCard key={img.id} img={img} disabled={disabled}
                    onView={setLightbox} onEdit={setEditImg} onDelete={setDeleteImg} />
                ))}
              </div>
            </div>
          ))}
        </>
      )}

      {/* ── CBCT Tab ── */}
      {activeTab==="cbct" && (
        <CBCTUploadSection visitId={visitId} disabled={disabled} />
      )}

      {/* ── Modals (each one is drawn on the page body, over everything) ── */}
      {showUpload && <UploadModal visitId={visitId} onClose={()=>setShowUpload(false)} onUploaded={()=>loadImages(false)} />}
      {editImg    && <EditModal   img={editImg}    onClose={()=>setEditImg(null)}     onSaved={()=>loadImages(false)} />}
      {deleteImg  && <DeleteModal img={deleteImg}  onClose={()=>setDeleteImg(null)}   onDeleted={()=>loadImages(false)} />}
      {viewing    && <Lightbox    img={viewing} images={ordered} onNavigate={setLightbox} onClose={()=>setLightbox(null)} />}
    </div>
  );
}