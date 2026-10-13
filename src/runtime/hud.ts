import { type Variable, type VariableStore, hudText } from '../core/logic';
import { UI_FONT_STACK } from '../core/fonts';

/**
 * The on-screen display of a running game: the variables marked "show on screen" (top right) and short
 * messages (bottom center). Plain DOM with inline styles, so it works in the editor and in an export.
 */
export class Hud {
  private root: HTMLElement;
  private list: HTMLElement;
  private toasts: HTMLElement;
  private rows: { variable: Variable; el: HTMLElement }[] = [];
  private seen = -1;
  private endLayer: HTMLElement | null = null;
  private dialogue: HTMLElement | null = null;
  /** The words of the conversation box: the part that can be read, and the part still to appear (kept for its size). */
  private dialogueText = '';
  private dialogueShown: HTMLElement | null = null;
  private dialogueRest: HTMLElement | null = null;
  private dialogueAnswers: HTMLElement | null = null;
  private tintEl: HTMLElement | null = null;
  private prompt: HTMLElement;

  constructor(private parent: HTMLElement) {
    this.root = document.createElement('div');
    Object.assign(this.root.style, {
      position: 'absolute',
      inset: '0',
      pointerEvents: 'none',
      zIndex: '20',
      fontFamily: UI_FONT_STACK,
      display: 'none',
    });
    this.list = document.createElement('div');
    Object.assign(this.list.style, {
      position: 'absolute',
      top: '12px',
      right: '14px',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'flex-end',
      gap: '6px',
    });
    this.toasts = document.createElement('div');
    Object.assign(this.toasts.style, {
      position: 'absolute',
      left: '0',
      right: '0',
      bottom: '64px',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '6px',
    });
    this.prompt = document.createElement('div');
    Object.assign(this.prompt.style, {
      position: 'absolute',
      left: '50%',
      bottom: '20px',
      transform: 'translateX(-50%)',
      padding: '6px 14px',
      borderRadius: '8px',
      background: 'rgba(20, 22, 30, 0.82)',
      color: '#ffd34d',
      fontSize: '16px',
      display: 'none',
    });
    this.root.append(this.list, this.toasts, this.prompt);
  }

  /** A hint such as "E: interact" at the bottom of the screen; null hides it. */
  setPrompt(text: string | null): void {
    if (text === null) {
      this.prompt.style.display = 'none';
      return;
    }
    if (this.prompt.textContent !== text) this.prompt.textContent = text;
    this.prompt.style.display = 'block';
  }

  /** Start showing the variables that have "show on screen" set. */
  show(variables: Variable[], store: VariableStore): void {
    if (!this.root.isConnected) this.parent.append(this.root);
    this.root.style.display = 'block';
    this.list.replaceChildren();
    this.toasts.replaceChildren();
    this.rows = [];
    for (const variable of variables.filter((v) => v.hud)) {
      const el = document.createElement('div');
      Object.assign(el.style, {
        padding: '5px 12px',
        borderRadius: '8px',
        background: 'rgba(20, 22, 30, 0.72)',
        color: '#fff',
        fontSize: '18px',
        fontWeight: '600',
        textShadow: '0 1px 2px rgba(0,0,0,0.6)',
      });
      this.list.append(el);
      this.rows.push({ variable, el });
    }
    this.seen = -1;
    this.update(store);
  }

  /** Redraw when a variable changed since the last call. */
  update(store: VariableStore): void {
    if (store.version === this.seen) return;
    this.seen = store.version;
    for (const { variable, el } of this.rows) el.textContent = hudText(variable, store.get(variable.name));
  }

  /** A message that stays for `seconds`. */
  toast(text: string, seconds: number): void {
    if (!text.trim()) return;
    const el = document.createElement('div');
    el.textContent = text;
    Object.assign(el.style, {
      padding: '8px 16px',
      borderRadius: '10px',
      background: 'rgba(20, 22, 30, 0.82)',
      color: '#fff',
      fontSize: '17px',
      transition: 'opacity 0.3s',
    });
    this.toasts.append(el);
    // keep the last few only
    while (this.toasts.childElementCount > 3) this.toasts.firstElementChild?.remove();
    window.setTimeout(() => {
      el.style.opacity = '0';
      window.setTimeout(() => el.remove(), 320);
    }, Math.max(0.3, seconds) * 1000);
  }

  /** A color over the whole screen while it is set (under water); null takes it away. */
  tint(color: string | null): void {
    if (!this.tintEl) {
      this.tintEl = document.createElement('div');
      Object.assign(this.tintEl.style, { position: 'absolute', inset: '0', pointerEvents: 'none', display: 'none' });
      this.root.prepend(this.tintEl);
    }
    if (!this.root.isConnected) return;
    this.tintEl.style.background = color ?? 'transparent';
    this.tintEl.style.display = color ? 'block' : 'none';
  }

  /** A short colored flash over the whole screen (the player got hurt). */
  flash(color = 'rgba(255, 32, 48, 0.45)'): void {
    if (!this.root.isConnected) return;
    const el = document.createElement('div');
    Object.assign(el.style, {
      position: 'absolute',
      inset: '0',
      background: color,
      opacity: '1',
      transition: 'opacity 0.45s ease-out',
      pointerEvents: 'none',
    });
    this.root.append(el);
    requestAnimationFrame(() => {
      el.style.opacity = '0';
    });
    window.setTimeout(() => el.remove(), 520);
  }

  /**
   * A conversation box at the bottom: the speaker, the line, and a hint. `answers` turn it into a
   * question with numbered buttons; `onAnswer` gets the index of the one picked (key 1-4 or a click).
   * `shown` is how many characters can be read at first (the rest appears with `setDialogueShown`); the
   * box already has the size of the whole line, so it does not jump while the words appear.
   */
  showDialogue(
    speaker: string,
    text: string,
    hint: string,
    answers: string[] = [],
    onAnswer: (i: number) => void = () => {},
    onNext: () => void = () => {},
    shown = text.length,
  ): void {
    this.hideDialogue();
    if (!this.root.isConnected) this.parent.append(this.root);
    this.root.style.display = 'block';
    const box = document.createElement('div');
    Object.assign(box.style, {
      position: 'absolute',
      left: '50%',
      bottom: '26px',
      transform: 'translateX(-50%)',
      width: 'min(720px, 88%)',
      boxSizing: 'border-box',
      padding: '14px 18px',
      borderRadius: '12px',
      background: 'rgba(16, 18, 28, 0.92)',
      border: '2px solid #fff',
      color: '#fff',
      fontSize: '18px',
      lineHeight: '1.45',
      pointerEvents: 'auto',
      cursor: answers.length > 0 ? 'default' : 'pointer',
    });
    if (speaker.trim()) {
      const name = document.createElement('div');
      name.textContent = speaker;
      Object.assign(name.style, { color: '#ffd34d', fontWeight: '700', marginBottom: '4px' });
      box.append(name);
    }
    const body = document.createElement('div');
    body.style.whiteSpace = 'pre-wrap';
    const seen = document.createElement('span');
    const rest = document.createElement('span');
    rest.style.visibility = 'hidden';
    body.append(seen, rest);
    box.append(body);
    this.dialogueText = text;
    this.dialogueShown = seen;
    this.dialogueRest = rest;
    this.setDialogueShown(shown);
    if (answers.length > 0) {
      const list = document.createElement('div');
      Object.assign(list.style, { display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '10px' });
      answers.forEach((label, i) => {
        const b = document.createElement('button');
        b.textContent = `${i + 1}. ${label}`;
        Object.assign(b.style, {
          font: 'inherit',
          textAlign: 'left',
          padding: '6px 12px',
          borderRadius: '8px',
          border: '1px solid #8aa0ff',
          background: '#25305a',
          color: '#fff',
          cursor: 'pointer',
        });
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          onAnswer(i);
        });
        list.append(b);
      });
      // the answers are there, but only readable once the question has been read
      list.style.visibility = shown >= text.length ? 'visible' : 'hidden';
      this.dialogueAnswers = list;
      box.append(list);
      // a click on the question shows it all at once
      box.addEventListener('click', onNext);
    } else {
      const h = document.createElement('div');
      h.textContent = hint;
      Object.assign(h.style, { color: '#9aa3b2', fontSize: '14px', marginTop: '8px', textAlign: 'right' });
      box.append(h);
      box.addEventListener('click', onNext);
    }
    this.root.append(box);
    this.dialogue = box;
  }

  /** Let the first `count` characters of the conversation box be read; the answers show up with the last one. */
  setDialogueShown(count: number): void {
    const seen = this.dialogueShown;
    const rest = this.dialogueRest;
    if (!seen || !rest) return;
    const n = Math.max(0, Math.min(count, this.dialogueText.length));
    seen.textContent = this.dialogueText.slice(0, n);
    rest.textContent = this.dialogueText.slice(n);
    if (this.dialogueAnswers) this.dialogueAnswers.style.visibility = n >= this.dialogueText.length ? 'visible' : 'hidden';
  }

  hideDialogue(): void {
    this.dialogue?.remove();
    this.dialogue = null;
    this.dialogueShown = this.dialogueRest = this.dialogueAnswers = null;
  }

  /** A full-screen message (win screen, game over) with buttons. */
  showEnd(title: string, text: string, buttons: { label: string; run: () => void }[]): void {
    this.hideEnd();
    if (!this.root.isConnected) this.parent.append(this.root);
    this.root.style.display = 'block';
    const layer = document.createElement('div');
    Object.assign(layer.style, {
      position: 'absolute',
      inset: '0',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '14px',
      background: 'rgba(10, 12, 20, 0.72)',
      color: '#fff',
      textAlign: 'center',
      pointerEvents: 'auto',
    });
    const heading = document.createElement('div');
    heading.textContent = title;
    Object.assign(heading.style, { fontSize: '44px', fontWeight: '700', textShadow: '0 2px 6px rgba(0,0,0,0.6)' });
    layer.append(heading);
    if (text.trim()) {
      const body = document.createElement('div');
      body.textContent = text;
      Object.assign(body.style, { fontSize: '20px', color: '#cfd5e0', maxWidth: '70%', whiteSpace: 'pre-wrap' });
      layer.append(body);
    }
    const row = document.createElement('div');
    Object.assign(row.style, { display: 'flex', gap: '12px', marginTop: '12px' });
    for (const b of buttons) {
      const btn = document.createElement('button');
      btn.textContent = b.label;
      Object.assign(btn.style, {
        font: 'inherit',
        fontSize: '18px',
        padding: '10px 22px',
        borderRadius: '10px',
        border: '2px solid #fff',
        background: '#2b3a67',
        color: '#fff',
        cursor: 'pointer',
      });
      btn.addEventListener('click', b.run);
      row.append(btn);
    }
    layer.append(row);
    this.root.append(layer);
    this.endLayer = layer;
  }

  hideEnd(): void {
    this.endLayer?.remove();
    this.endLayer = null;
  }

  hide(): void {
    this.hideEnd();
    this.hideDialogue();
    this.tint(null);
    this.setPrompt(null);
    this.root.style.display = 'none';
    this.list.replaceChildren();
    this.toasts.replaceChildren();
    this.rows = [];
  }
}
