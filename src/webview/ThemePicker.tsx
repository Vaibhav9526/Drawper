import { useEffect, useRef, useState } from 'react';
import { THEMES, PanelTheme } from './themes';

type Props = { value: PanelTheme; onChange: (id: string) => void };

export function ThemePicker({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', away, true);
    document.addEventListener('keydown', esc, true);
    return () => { document.removeEventListener('pointerdown', away, true); document.removeEventListener('keydown', esc, true); };
  }, [open]);

  return (
    <div className="theme-picker" ref={box}>
      <button className="theme-btn" onClick={() => setOpen((o) => !o)} title={`Theme: ${value.label}`} aria-label="Change theme" aria-expanded={open}>
        <span className="dot" style={{ background: value.accent }} />
        <span className="lbl">Theme</span>
      </button>
      {open && (
        <div className="theme-pop" role="menu">
          {THEMES.map((t) => (
            <button key={t.id} role="menuitemradio" aria-checked={t.id === value.id} className={t.id === value.id ? 'on' : ''} onClick={() => { onChange(t.id); setOpen(false); }}>
              <span className="swatch" style={{ background: t.accent }} />
              {t.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
