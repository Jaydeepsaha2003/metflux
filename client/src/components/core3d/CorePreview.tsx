// The chrome around the 3D viewer: header, states, and the lazy boundary.
//
// three.js is around 160KB gzipped, which is more than the rest of this page
// put together. It is behind React.lazy so it downloads only once someone has
// typed a set of dimensions worth drawing — an operator who never opens a line
// form never pays for it, and it never lands in the main bundle.
import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { Box, Loader2, RotateCcw, Maximize2, X, Ruler, Download, FileText, Image as ImageIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import { shapeIsDrawable, shapeCaption, type CoreShape } from './shape';
import type { SheetMeta } from './specSheet';

const CoreViewer = lazy(() => import('./CoreViewer'));

const TONE = {
  TOROIDAL:    { dot: 'bg-amber-500',  label: 'text-amber-800',  ring: 'border-amber-200' },
  RECTANGULAR: { dot: 'bg-rose-500',   label: 'text-rose-800',   ring: 'border-rose-200' },
  NANO:        { dot: 'bg-violet-500', label: 'text-violet-800', ring: 'border-violet-200' },
  COMPOSITE:   { dot: 'bg-teal-500',   label: 'text-teal-800',   ring: 'border-teal-200' },
  CUT_ROUND:   { dot: 'bg-sky-500',    label: 'text-sky-800',    ring: 'border-sky-200' },
  CUT_RECT:    { dot: 'bg-cyan-500',   label: 'text-cyan-800',   ring: 'border-cyan-200' },
} as const;

const TITLE = {
  TOROIDAL: 'Toroidal core',
  RECTANGULAR: 'Rectangular core',
  NANO: 'Nano core',
  COMPOSITE: 'Composite core',
  CUT_ROUND: 'Round cut core',
  CUT_RECT: 'Rectangular cut core',
} as const;

/* A gapped core is a different product from the plain cut core it is made from,
   and the form's own heading already says so. The panel has to agree, or the
   two headings sitting side by side read as a mistake. */
const titleOf = (shape: CoreShape) =>
  (shape.kind === 'CUT_ROUND' && shape.gapMm > 0) ? 'Round gap core'
  : (shape.kind === 'CUT_RECT' && shape.gapMm > 0) ? 'Rectangular gap core'
  : TITLE[shape.kind];

/* The stage the model sits on. A soft radial wash rather than a flat fill, so
   the part reads as lit from above and the shadow it casts has something to
   fall on. */
const STAGE = 'bg-[radial-gradient(120%_90%_at_50%_0%,#ffffff_0%,#eef2f7_45%,#dde5ee_100%)]';

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
    <div className={cn('relative flex-1 overflow-hidden', STAGE)}>
      {drawable ? (
        <Suspense fallback={<Waiting label="Loading viewer…" />}>
          <CoreViewer shape={shape} resetNonce={resetNonce} showDims={showDims} />
        </Suspense>
      ) : (
        <Empty kind={shape.kind} />
      )}

      {drawable && (
        <>
          {/* Controls float over the stage so the model keeps the full frame. */}
          <div className="absolute right-2 top-2 flex gap-1">
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
                <div className="absolute right-0 top-full z-20 mt-1 w-44 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl">
                  <MenuItem icon={<FileText className="h-3.5 w-3.5" />} onClick={() => download('pdf')}>
                    PDF spec sheet
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
          {failed && (
            <div className="absolute inset-x-2 top-12 rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5 text-[11px] font-medium text-amber-900 shadow-sm">
              Could not build the sheet. Nothing was downloaded.
            </div>
          )}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-2">
            <span className="rounded-md bg-white/75 px-1.5 py-0.5 font-num text-[10px] font-semibold text-slate-700 backdrop-blur-sm">
              {caption}
            </span>
            <span className="rounded-md bg-white/60 px-1.5 py-0.5 text-[10px] text-slate-500 backdrop-blur-sm">
              drag to rotate · scroll to zoom
            </span>
          </div>
        </>
      )}
    </div>
  );

  return (
    <>
      <div className={cn('flex flex-col overflow-hidden rounded-xl border bg-white shadow-sm', tone.ring, className)}>
        <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2">
          <span className={cn('h-2 w-2 shrink-0 rounded-full', tone.dot)} />
          <span className={cn('text-[11px] font-bold uppercase tracking-wider', tone.label)}>
            {titleOf(shape)}
          </span>
          <span className="ml-auto inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-slate-400">
            <Box className="h-3 w-3" /> 3D
          </span>
        </div>
        {stage}
      </div>

      {/* Expanded view. Same component, so the model is rebuilt at a size where
          proportions are actually judgeable — useful when showing a customer. */}
      {full && drawable && (
        <div
          className="fixed inset-0 z-[120] flex flex-col bg-slate-900/70 p-3 backdrop-blur-sm sm:p-6"
          onClick={() => setFull(false)}
        >
          <div
            className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2">
              <span className={cn('h-2 w-2 rounded-full', tone.dot)} />
              <span className={cn('text-[11px] font-bold uppercase tracking-wider', tone.label)}>{titleOf(shape)}</span>
              <span className="font-num text-[11px] font-semibold text-slate-500">{caption}</span>
              <button
                type="button"
                onClick={() => setResetNonce((n) => n + 1)}
                className="ml-auto rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                aria-label="Reset view"
                title="Reset view"
              >
                <RotateCcw className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setFull(false)}
                className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className={cn('relative min-h-0 flex-1', STAGE)}>
              <Suspense fallback={<Waiting label="Loading viewer…" />}>
                <CoreViewer shape={shape} resetNonce={resetNonce} showDims={showDims} />
              </Suspense>
            </div>
          </div>
        </div>
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
    className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] font-medium text-slate-700 transition hover:bg-slate-50"
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
    className={cn(
      'rounded-md border p-1.5 shadow-sm backdrop-blur-sm transition',
      active
        ? 'border-blue-300 bg-blue-50/90 text-blue-700 hover:bg-blue-100'
        : 'border-white/70 bg-white/70 text-slate-600 hover:bg-white hover:text-slate-900'
    )}
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
