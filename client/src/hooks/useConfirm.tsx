// Promise-based replacement for window.confirm — pairs with <ConfirmDialog/>.
// Usage:
//
//   const { confirm, confirmDialog } = useConfirm();
//
//   const onDelete = async () => {
//     const ok = await confirm({
//       title: 'Delete customer?',
//       message: 'This cannot be undone.',
//       tone: 'danger',
//       confirmLabel: 'Delete',
//     });
//     if (ok) remove.mutate(id);
//   };
//
//   return <> ... {confirmDialog} </>;
//
// The dialog node must be rendered somewhere in the page tree.
import { ReactNode, useRef, useState } from 'react';
import { ConfirmDialog, ConfirmTone } from '@/components/ConfirmDialog';

type ConfirmOpts = {
  title: string;
  message?: ReactNode;
  tone?: ConfirmTone;
  confirmLabel?: string;
  cancelLabel?: string;
  /** When true, the cancel button is hidden — use for plain "OK" notifications. */
  alertOnly?: boolean;
  /** Require the user to type this exact text before Confirm unlocks. */
  challenge?: string;
};

export const useConfirm = () => {
  const [opts, setOpts] = useState<ConfirmOpts | null>(null);
  const resolver = useRef<((v: boolean) => void) | null>(null);

  const confirm = (o: ConfirmOpts) =>
    new Promise<boolean>((resolve) => {
      resolver.current = resolve;
      setOpts(o);
    });

  const close = (result: boolean) => {
    resolver.current?.(result);
    resolver.current = null;
    setOpts(null);
  };

  const confirmDialog = (
    <ConfirmDialog
      open={!!opts}
      title={opts?.title ?? ''}
      message={opts?.message}
      tone={opts?.tone}
      confirmLabel={opts?.confirmLabel}
      cancelLabel={opts?.cancelLabel}
      alertOnly={opts?.alertOnly}
      challenge={opts?.challenge}
      onConfirm={() => close(true)}
      onCancel={() => close(false)}
    />
  );

  // Convenience wrapper for plain notification messages.
  const alert = (o: Omit<ConfirmOpts, 'alertOnly' | 'cancelLabel'>) =>
    confirm({ ...o, alertOnly: true, confirmLabel: o.confirmLabel ?? 'OK' });

  return { confirm, alert, confirmDialog };
};
