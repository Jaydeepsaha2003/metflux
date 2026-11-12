// The core-building block — alloy buttons, core-shape list, the calculation form for
// the chosen core, and the 3D model dock — as one component, so a screen that needs
// to build a core does not carry its own copy of it. (The Sales Order and the
// Quotation each carry theirs inline, and those two have already drifted apart once.)
//
// It knows nothing about customers or what the screen does with the finished item:
// it hands back the same `Item` the Sales Order forms produce.
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { SearchableSelect } from '@/components/SearchableSelect';
import CorePreview from '@/components/core3d/CorePreview';
import {
  type Item, type ShapeReport, type GradeRow, ToroidalForm, RectangularForm, NanoForm,
  StackedCoreForm, emptyShapeFor, gradeAppliesTo, Field,
} from '@/pages/POOrderNewPage';
import type { CoreType } from '@/lib/coreTypes';
import type { MaterialKey } from '@/lib/coreMaterials';
import { useAuthStore, activeMembership } from '@/store/auth';
import '@/pages/po-order-new.css';

type Family = MaterialKey | 'COMPOSITE';

export const CoreBuilder = ({ onAdd, customerName, orderNo }: {
  onAdd: (item: Item) => void;
  /** Shown in the title block of a downloaded drawing sheet. */
  customerName?: string | null;
  orderNo?: string | null;
}) => {
  const [family, setFamily] = useState<Family>('CRGO');
  const [gapMode, setGapMode] = useState(false);
  const [coreType, setCoreType] = useState<CoreType | ''>('');
  const [report, setReport] = useState<ShapeReport | null>(null);
  const companyName = useAuthStore((st) => activeMembership(st)?.companyName ?? null);

  const { data } = useQuery({ queryKey: ['material-grades'], queryFn: () => api<{ grades: GradeRow[] }>('/material-grades') });
  const gradesFor = (ct: CoreType) => (data?.grades ?? []).filter((g) => gradeAppliesTo(g, ct));

  // Clearing the report on a switch stops the old solid showing under the new form.
  const pickCore = (ct: CoreType) => { setReport(null); setCoreType(ct); };
  const selectShape = (value: string, nextFamily: Family = family) => {
    setGapMode(value === 'GAP');
    pickCore(
      value === 'GAP' ? 'CUT_ROUND'
      : value === 'LINE_OF_CUT' ? (coreType === 'CUT_RECT' ? 'CUT_RECT' : 'CUT_ROUND')
      : value === 'ROUND' ? (nextFamily === 'NANOCRYSTALLINE' ? 'NANO' : 'TOROIDAL')
      : value as CoreType,
    );
  };
  const selectFamily = (next: Family) => {
    setFamily(next);
    if (next === 'COMPOSITE') { setGapMode(false); pickCore('COMPOSITE'); }
    else selectShape(gapMode ? 'GAP' : !coreType || ['TOROIDAL', 'NANO', 'COMPOSITE'].includes(coreType) ? 'ROUND' : coreType, next);
  };

  const alloy = family === 'COMPOSITE' ? undefined : family;
  // No flux-test calibration here: that belongs to the order being tested, not bought.
  const common = { hideTesting: true, onShape: setReport, onAdd, fluxGrades: [] };

  return (
    <div className="sales-order-workbench">
      <section data-core={coreType || 'TOROIDAL'} className="sales-order-section sales-order-entry card p-3 sm:p-4 space-y-3">
        <div className="sales-order-section-heading flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-sm font-semibold text-slate-900">Build core item</h2>
          <div className="grid grid-cols-2 sm:flex gap-1 w-full sm:w-auto" aria-label="Material family">
            {([{ value: 'CRGO', label: 'CRGO' }, { value: 'NANOCRYSTALLINE', label: 'Nano Crystalline' }, { value: 'AMORPHOUS', label: 'Amorphous' }, { value: 'COMPOSITE', label: 'Composite' }] as const).map((o) => (
              <button key={o.value} type="button" aria-pressed={family === o.value} onClick={() => selectFamily(o.value)}
                className={cn('flex-1 sm:flex-none border px-3 py-2 text-xs font-semibold transition shadow-sm',
                  family === o.value ? 'border-brand-500 bg-gradient-to-b from-brand-500 to-brand-700 text-white' : 'border-slate-200 bg-gradient-to-b from-white to-slate-50 text-slate-700 hover:border-brand-400')}>
                {o.label}
              </button>
            ))}
          </div>
        </div>

        {family !== 'COMPOSITE' && (
          <div className="grid gap-3 sm:grid-cols-2 lg:max-w-2xl">
            <Field label="Core shape">
              <SearchableSelect value={gapMode ? 'GAP'
                : coreType === 'NANO' || coreType === 'TOROIDAL' ? 'ROUND'
                : coreType === 'CUT_ROUND' || coreType === 'CUT_RECT' ? 'LINE_OF_CUT'
                : coreType}
                onChange={(v) => selectShape(v)} placeholder="Choose core shape…"
                options={[{ value: 'ROUND', label: 'Round (Toroidal)' }, { value: 'RECTANGULAR', label: 'Rectangular' }, { value: 'LINE_OF_CUT', label: 'Line of cut core' }, { value: 'GAP', label: 'Gap core' }, { value: 'E_CORE', label: 'E core' }, { value: 'EI_CORE', label: 'EI core' }, { value: 'WOUND_CORE', label: 'Wound core' }, { value: 'STEP_CORE', label: 'Step core' }]} />
            </Field>
            {gapMode && <Field label="Gap core shape"><SearchableSelect value={coreType} onChange={(v) => pickCore(v as CoreType)} options={[{ value: 'CUT_ROUND', label: 'Round gap' }, { value: 'CUT_RECT', label: 'Rectangular gap' }]} /></Field>}
            {!gapMode && (coreType === 'CUT_ROUND' || coreType === 'CUT_RECT') && (
              <Field label="Cut core profile">
                <SearchableSelect value={coreType} onChange={(v) => pickCore(v as CoreType)} options={[{ value: 'CUT_ROUND', label: 'Round' }, { value: 'CUT_RECT', label: 'Rectangular' }]} />
              </Field>
            )}
          </div>
        )}

        <div className="core-builder-layout grid gap-3 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0" key={`${family}-${coreType}-${gapMode}`}>
            {coreType === 'TOROIDAL' && <ToroidalForm {...common} selectedAlloy={alloy} requireGap={gapMode} grades={gradesFor('TOROIDAL')} />}
            {coreType === 'RECTANGULAR' && <RectangularForm {...common} selectedAlloy={alloy} requireGap={gapMode} grades={gradesFor('RECTANGULAR')} />}
            {coreType === 'NANO' && <NanoForm {...common} grades={gradesFor('NANO')} />}
            {coreType === 'COMPOSITE' && <NanoForm {...common} composite grades={gradesFor('NANO')} typeGrades={gradesFor('COMPOSITE')} />}
            {coreType === 'CUT_ROUND' && <ToroidalForm {...common} cut selectedAlloy={alloy} requireGap={gapMode} grades={gradesFor('CUT_ROUND')} />}
            {coreType === 'CUT_RECT' && <RectangularForm {...common} cut selectedAlloy={alloy} requireGap={gapMode} grades={gradesFor('CUT_RECT')} />}
            {(coreType === 'E_CORE' || coreType === 'EI_CORE' || coreType === 'WOUND_CORE' || coreType === 'STEP_CORE') && (
              <StackedCoreForm kind={coreType} hideTesting onShape={setReport} onAdd={onAdd} selectedAlloy={alloy} grades={gradesFor(coreType)} />
            )}
            {!coreType && (
              <div className="rounded-lg border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500">
                Pick a core type above to calculate its size and weight and see it in 3D.
              </div>
            )}
          </div>

          {coreType && (
            <div className="min-w-0 xl:sticky xl:top-3 xl:self-start">
              <CorePreview
                shape={report?.shape ?? emptyShapeFor(coreType)}
                meta={{ ...(report?.meta ?? {}), company: companyName, customer: customerName ?? null, orderNo: orderNo ?? null }}
                className="core-model-stage h-[260px] xl:h-[360px]"
              />
            </div>
          )}
        </div>
      </section>
    </div>
  );
};
