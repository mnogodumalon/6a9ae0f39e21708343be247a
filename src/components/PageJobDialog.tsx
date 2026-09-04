import { useEffect, useRef, useState } from 'react';
import { IconLoader2, IconAlertTriangle, IconCheck, IconSparkles } from '@tabler/icons-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { startPageJob, type PageKind, type PageOp, type PageJobOutcome, type PageJobStage } from '@/lib/pageJobs';
import { t } from '@/i18n';

/**
 * PageJobDialog — the one place in the dashboard where a page is created,
 * changed or removed by the agent. The owner types a wish, the job starts at
 * once (no second confirm — the prompt IS the decision), the dialog shows the
 * build's stages and ends with "Neu laden". Delete asks for confirmation and
 * runs without a prompt.
 *
 * Closing the dialog while the job runs does not stop it: Klar builds on,
 * VersionCheck offers the reload when the new bundle is live.
 */
export interface PageJobTarget {
  slug: string;
  title: string;
}

export interface PageJobDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: PageKind;
  op: PageOp;
  target?: PageJobTarget;
  /** Called after a successful job (the caller may refresh its list). */
  onDone?: () => void;
  /** Called when a job was started (running) — lists start polling faster. */
  onStarted?: () => void;
  /** Prefill — a retry of a failed job reopens with its prompt. */
  initialPrompt?: string;
}

type Phase = 'idle' | 'running' | 'done' | 'busy' | 'error';

function titleKey(kind: PageKind, op: PageOp): string {
  return `pj_title_${op}_${kind}`;
}

export function PageJobDialog({ open, onOpenChange, kind, op, target, onDone, onStarted, initialPrompt }: PageJobDialogProps) {
  const [prompt, setPrompt] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [stage, setStage] = useState<PageJobStage | null>(null);
  const [lastStatus, setLastStatus] = useState('');
  const [message, setMessage] = useState('');
  const startedAt = useRef<number>(0);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!open) {
      // A fresh dialog per wish; a running job keeps running server-side.
      setPrompt('');
      setPhase('idle');
      setStage(null);
      setLastStatus('');
      setMessage('');
    } else if (initialPrompt) {
      setPrompt(initialPrompt);
    }
  }, [open, initialPrompt]);

  useEffect(() => {
    if (phase !== 'running') return;
    const id = window.setInterval(() => setElapsed(Math.round((Date.now() - startedAt.current) / 1000)), 1000);
    return () => window.clearInterval(id);
  }, [phase]);

  const needsPrompt = op !== 'delete';
  const canStart = phase === 'idle' || phase === 'error' || phase === 'busy';
  const startDisabled = !canStart || (needsPrompt && prompt.trim().length < 3);

  const run = async () => {
    setPhase('running');
    setMessage('');
    setStage(null);
    startedAt.current = Date.now();
    setElapsed(0);
    onStarted?.();
    let outcome: PageJobOutcome;
    try {
      outcome = await startPageJob(
        { kind, op, target: target?.slug, prompt: needsPrompt ? prompt.trim() : undefined },
        {
          onStage: s => setStage(s),
          onStatus: line => setLastStatus(line),
          onWarning: line => setLastStatus(line),
        },
      );
    } catch {
      setPhase('error');
      setMessage(t('pj_error_network'));
      return;
    }
    if (outcome.status === 'done') {
      setPhase('done');
      onDone?.();
    } else if (outcome.status === 'busy') {
      setPhase('busy');
      setMessage(t('pj_busy', { minutes: Math.max(1, Math.floor(outcome.ageSeconds / 60)) }));
    } else {
      setPhase('error');
      setMessage(outcome.message);
    }
  };

  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const ss = String(elapsed % 60).padStart(2, '0');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t(titleKey(kind, op))}</DialogTitle>
          {target ? <DialogDescription>{target.title}</DialogDescription> : null}
        </DialogHeader>

        {phase === 'idle' || phase === 'error' || phase === 'busy' ? (
          <div className="space-y-3">
            {needsPrompt ? (
              <>
                <label htmlFor="pj-prompt" className="text-sm font-medium">{t('pj_prompt_label')}</label>
                <Textarea
                  id="pj-prompt"
                  value={prompt}
                  onChange={e => setPrompt(e.target.value)}
                  rows={4}
                  autoFocus
                  placeholder={op === 'edit' ? t('pj_prompt_edit_placeholder') : t(kind === 'flow' ? 'pj_prompt_placeholder_flow' : 'pj_prompt_placeholder_public')}
                />
                <p className="text-xs text-muted-foreground">{t('pj_prompt_hint')}</p>
              </>
            ) : (
              <p className="text-sm">{t(kind === 'flow' ? 'pj_delete_flow_text' : 'pj_delete_public_text')}</p>
            )}
            {phase === 'error' ? (
              <div className="flex items-start gap-2 rounded-2xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
                <IconAlertTriangle size={16} stroke={1.5} className="mt-0.5 shrink-0" />
                <span><span className="font-medium">{t('pj_failed')}:</span> {message}</span>
              </div>
            ) : null}
            {phase === 'busy' ? (
              <p className="text-sm text-muted-foreground" role="status">{message}</p>
            ) : null}
          </div>
        ) : null}

        {phase === 'running' ? (
          <div className="space-y-3" role="status" aria-live="polite">
            <div className="flex items-center gap-2 text-sm">
              <IconLoader2 size={18} stroke={1.5} className="animate-spin text-primary shrink-0" />
              <span className="font-medium">{stage?.label ?? t('pj_starting')}</span>
              <span className="ml-auto tabular-nums text-muted-foreground">{mm}:{ss}</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
              <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.min(100, stage?.pct ?? 5)}%` }} />
            </div>
            {lastStatus ? <p className="truncate text-xs text-muted-foreground">{lastStatus}</p> : null}
            <p className="text-xs text-muted-foreground">{t('pj_running')}</p>
          </div>
        ) : null}

        {phase === 'done' ? (
          <div className="flex items-start gap-2 text-sm" role="status">
            <IconCheck size={18} stroke={1.5} className="text-primary shrink-0 mt-0.5" />
            <span>{t(op === 'delete' ? 'pj_done_delete' : 'pj_done')}</span>
          </div>
        ) : null}

        <DialogFooter>
          {phase === 'done' ? (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>{t('pj_close')}</Button>
              <Button onClick={() => window.location.reload()}>{t('pj_reload')}</Button>
            </>
          ) : phase === 'running' ? (
            <Button variant="outline" onClick={() => onOpenChange(false)}>{t('pj_close')}</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>{t('pj_cancel')}</Button>
              <Button variant={op === 'delete' ? 'destructive' : 'default'} disabled={startDisabled} onClick={run}>
                {op !== 'delete' ? <IconSparkles size={16} stroke={1.5} className="mr-1" /> : null}
                {phase === 'error' ? t('pj_retry') : t(op === 'delete' ? 'pj_start_delete' : op === 'edit' ? 'pj_start_edit' : 'pj_start')}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
