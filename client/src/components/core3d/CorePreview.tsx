// The chrome around the 3D viewer: header, states, and the lazy boundary.
//
// three.js is around 160KB gzipped, which is more than the rest of this page
// put together. It is behind React.lazy so it downloads only once someone has
// typed a set of dimensions worth drawing — an operator who never opens a line
// form never pays for it, and it never lands in the main bundle.
import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Box, Loader2, RotateCcw, Maximize2, X, Ruler, Download, FileText, Image as ImageIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import { shapeIsDrawable, shapeCaption, shapeTitle, type CoreShape } from './shape';
import type { SheetMeta } from './specSheet';
import './CorePreview.css';

const CoreViewer = lazy(() => import('./CoreViewer'));

const TONE = {
  TOROIDAL:    { dot: 'bg-amber-500',  label: 'text-amber-800',  ring: 'border-amber-200' },
  RECTANGULAR: { dot: 'bg-rose-500',   label: 'text-rose-800',   ring: 'border-rose-200' },
  NANO:        { dot: 'bg-violet-500', label: 'text-violet-800', ring: 'border-violet-200' },
  COMPOSITE:   { dot: 'bg-teal-500',   label: 'text-teal-800',   ring: 'border-teal-200' },
  CUT_ROUND:   { dot: 'bg-sky-500',    label: 'text-sky-800',    ring: 'border-sky-200' },
  CUT_RECT:    { dot: 'bg-cyan-500',   label: 'text-cyan-800',   ring: 'border-cyan-200' },
  E_CORE:       { dot: 'bg-indigo-500', label: 'text-indigo-800', ring: 'border-indigo-200' },
  EI_CORE:      { dot: 'bg-indigo-500', label: 'text-indigo-800', ring: 'border-indigo-200' },
  WOUND_CORE:  { dot: 'bg-orange-500', label: 'text-orange-800', ring: 'border-orange-200' },
  STEP_CORE:   { dot: 'bg-emerald-500', label: 'text-emerald-800', ring: 'border-emerald-200' },
} as const;

/* The product's name comes from shape.ts, so the panel, the form heading and
   the spec sheet cannot disagree about what is on the screen. */
const titleOf = shapeTitle;

export const CorePreview = ({ shape, className, meta }: {
  shape: CoreShape;
  className?: string;
  /** Context for the downloadable spec sheet — customer, grade, weights. */
  meta?: SheetMeta;
}) => {
  const [resetNonce, setResetNonce] = useState(0);
  const [full, setFull] = useState(false);
  // Dimensions are on by default: the reason to look at the model at all is to
  // check the numbers, and an unlabelled solid answers a different question.
  const [showDims, setShowDims] = useState(true);
  const [view,setView] = useState<'iso' | 'top' | 'front'>('iso');
  const viewButtons = <div className="core-preview-views" role="group" aria-label="Model orientation">
    {(['iso','top','front'] as const).map(v=><button key={v} type="button" aria-pressed={view===v} onClick={()=>{setView(v);setResetNonce(n=>n+1);}} className="core-preview-view">{v==='iso'?'3D':v==='top'?'Top':'Front'}</button>)}
  </div>;
  const [menu, setMenu] = useState(false);
  const [busy, setBusy] = useState<null | 'pdf' | 'jpg'>(null);
  const [failed, setFailed] = useState(false);
  const drawable = shapeIsDrawable(shape);
  const tone = TONE[shape.kind];
  const caption = useMemo(() => (drawable ? shapeCaption(shape) : null), [shape, drawable]);

  // Escape closes the expanded view. Anything that covers the whole screen has
  // to answer Escape, or someone mid-order has to hunt for the close button.
  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setFull(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [full]);

  // The download menu closes on Escape or on any click elsewhere, like every
  // other menu on the page.
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(false);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', close);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', close);
    };
  }, [menu]);

  /* The sheet modules — pdfmake, the fonts, the sketch — are only imported when
     someone actually asks for a download, so they stay out of the page load. */
  const download = async (kind: 'pdf' | 'jpg') => {
    setMenu(false);
    setFailed(false);
    setBusy(kind);
    try {
      const mod = await import('./specSheet');
      const info: SheetMeta = meta ?? {};
      if (kind === 'pdf') await mod.downloadSheetPdf(shape, info);
      else await mod.downloadSheetJpg(shape, info);
    } catch {
      // Nothing was saved, so say so rather than leaving the spinner to stop
      // and look like success.
      setFailed(true);
    } finally {
      setBusy(null);
    }
  };

  const stage = (
    <div className="core-preview-stage relative flex-1 overflow-hidden">
      {drawable ? (
        <Suspense fallback={<Waiting label="Loading viewer…" />}>
          <CoreViewer shape={shape} resetNonce={resetNonce} showDims={showDims} view={view} />
        </Suspense>
      ) : (
        <Empty kind={shape.kind} />
      )}

      {drawable && (
        <>
          <div className="core-preview-toolbar absolute inset-x-2 top-2 z-10 flex items-start justify-between gap-2">
            {viewButtons}
            <div className="flex shrink-0 gap-1">
            <GlassBtn
              title={showDims ? 'Hide dimensions' : 'Show dimensions'}
              active={showDims}
              onClick={() => setShowDims((v) => !v)}
            >
              <Ruler className="h-3.5 w-3.5" />
            </GlassBtn>
            <GlassBtn title="Reset view" onClick={() => setResetNonce((n) => n + 1)}>
              <RotateCcw className="h-3.5 w-3.5" />
            </GlassBtn>
            <div className="relative" onPointerDown={(e) => e.stopPropagation()}>
              <GlassBtn
                title="Download spec sheet"
                onClick={() => setMenu((v) => !v)}
                active={menu}
              >
                {busy
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <Download className="h-3.5 w-3.5" />}
              </GlassBtn>
              {menu && (
                <div className="core-preview-menu absolute right-0 top-full z-20 mt-1 w-44 overflow-hidden">
                  <MenuItem icon={<FileText className="h-3.5 w-3.5" />} onClick={() => download('pdf')}>
                    PDF drawing + specs
                  </MenuItem>
                  <MenuItem icon={<ImageIcon className="h-3.5 w-3.5" />} onClick={() => download('jpg')}>
                    JPG image
                  </MenuItem>
                </div>
              )}
            </div>
            <GlassBtn title={full ? 'Close' : 'Expand'} onClick={() => setFull((v) => !v)}>
              {full ? <X className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
            </GlassBtn>
            </div>
          </div>
          {failed && (
            <div className="absolute inset-x-2 top-14 z-10 border border-amber-300 bg-amber-50 px-2 py-1.5 text-[11px] font-medium text-amber-900 shadow-sm">
              Could not build the sheet. Nothing was downloaded.
            </div>
          )}
          <div className="core-preview-footer pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 px-2.5 py-2">
            <span className="core-preview-caption font-num text-[10px] font-semibold text-slate-700">
              {caption}
            </span>
            <span className="core-preview-hint text-[10px] font-medium text-slate-600">
              Drag · zoom · mm
            </span>
          </div>
        </>
      )}
    </div>
  );

  return (
    <>
      <div className={cn('core-preview-panel flex flex-col overflow-hidden border', tone.ring, className)}>
        <div className="core-preview-heading flex items-center gap-2 px-3 py-2">
          <span className={cn('h-2 w-2 shrink-0', tone.dot)} />
          <span className={cn('min-w-0 truncate text-[11px] font-bold uppercase tracking-wider', tone.label)}>
            {titleOf(shape)}
          </span>
          <span className="core-preview-live ml-auto inline-flex shrink-0 items-center gap-1.5 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-600">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Live model
          </span>
        </div>
        {stage}
      </div>

      {/* Expanded view. Same component, so the model is rebuilt at a size where
          proportions are actually judgeable — useful when showing a customer.

          Rendered through a portal, and it has to be. The dock this preview
          sits in is `xl:sticky`, and position:sticky creates a stacking
          context — so z-[120] was being scoped inside that dock and the
          sidebar, at a mere z-40 but in the root context, painted straight over
          the top of it. Only above 1280px, because that is where the dock
          becomes sticky, which is exactly the sort of bug that looks fine on a
          laptop and wrong on the machine it is used on. A portal puts the
          overlay on <body>, where nothing can trap it. */}
      {full && drawable && createPortal(
        <div
          className="fixed inset-0 z-[120] flex flex-col bg-slate-950/75 p-2 backdrop-blur-md sm:p-6"
          onClick={() => setFull(false)}
        >
          <div
            className="core-preview-panel flex min-h-0 flex-1 flex-col overflow-hidden border border-white/70"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="core-preview-heading flex items-center gap-2 px-3 py-2">
              <span className={cn('h-2 w-2 rounded-full', tone.dot)} />
              <span className={cn('text-[11px] font-bold uppercase tracking-wider', tone.label)}>{titleOf(shape)}</span>
              <span className="hidden font-num text-[11px] font-semibold text-slate-500 sm:inline">{caption}</span>
              <button
                type="button"
                onClick={() => setResetNonce((n) => n + 1)}
                className="core-preview-header-action ml-auto p-1.5"
                aria-label="Reset view"
                title="Reset view"
              >
                <RotateCcw className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setFull(false)}
                className="core-preview-header-action p-1.5"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="core-preview-stage relative min-h-0 flex-1">
              <div className="absolute left-2 top-2 z-10">{viewButtons}</div>
              <Suspense fallback={<Waiting label="Loading viewer…" />}>
                <CoreViewer shape={shape} resetNonce={resetNonce} showDims={showDims} view={view} />
              </Suspense>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
};

const MenuItem = ({ icon, onClick, children }: {
  icon: React.ReactNode; onClick: () => void; children: React.ReactNode;
}) => (
  <button
    type="button"
    onClick={onClick}
    className="core-preview-menu-item flex w-full items-center gap-2 px-3 py-2.5 text-left text-[12px] font-semibold text-slate-700 transition"
  >
    <span className="text-slate-400">{icon}</span>
    {children}
  </button>
);

const GlassBtn = ({ title, onClick, children, active }: {
  title: string; onClick: () => void; children: React.ReactNode; active?: boolean;
}) => (
  <button
    type="button"
    title={title}
    aria-label={title}
    aria-pressed={active}
    onClick={onClick}
    className={cn('core-preview-action flex h-8 w-8 items-center justify-center border transition', active && 'core-preview-action-active')}
  >
    {children}
  </button>
);

const Waiting = ({ label }: { label: string }) => (
  <div className="flex h-full w-full items-center justify-center gap-2 text-[11px] text-slate-400">
    <Loader2 className="h-3.5 w-3.5 animate-spin" /> {label}
  </div>
);

/* What is shown before there is anything to draw. It names the fields still
   needed rather than showing an empty box, so it doubles as a prompt. */
const Empty = ({ kind }: { kind: CoreShape['kind'] }) => (
  <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 px-4 text-center">
    <Box className="h-7 w-7 text-slate-300" strokeWidth={1.4} />
    <div className="text-[11px] font-medium text-slate-500">Model appears here</div>
    <div className="text-[10px] leading-relaxed text-slate-400">
      {kind === 'RECTANGULAR' || kind === 'CUT_RECT'
        ? 'Enter ID 1, ID 2, OD 1, OD 2 and HT (outer must exceed inner).'
        : kind === 'CUT_ROUND'
          ? 'Enter ID, OD and HT of the core before it is cut.'
        : kind === 'COMPOSITE'
          ? 'Enter both the CRGO and Nano dimensions, and pick a join type.'
          : 'Enter ID, OD and HT (OD must be greater than ID).'}
    </div>
  </div>
);

export default CorePreview;
