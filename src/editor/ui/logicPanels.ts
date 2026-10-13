import {
  ACTION_LABELS,
  type Action,
  type ActionType,
  COMPARE_OPS,
  type CompareOp,
  type Condition,
  DEFAULT_TEXT_SPEED,
  MAX_TEXT_SPEED,
  MAX_VOICE_PITCH,
  MIN_VOICE_PITCH,
  RULE_EVENTS,
  SILENT_VOICE,
  type Rule,
  type RuleEvent,
  type Variable,
} from '../../core/logic';
import { PRESETS, type PresetKind, presetRules } from '../../core/presets';
import { SOUND_IDS, TALK_VOICES, builtInSound } from '../../core/sounds';
import { clear, el } from './dom';

const ACTION_TYPES = Object.keys(ACTION_LABELS) as ActionType[];

function numberInput(value: number, onValue: (v: number) => void, step = 1, width = '64px'): HTMLInputElement {
  const input = el('input', { type: 'number', step: String(step), value: String(value) });
  input.style.width = width;
  input.addEventListener('change', () => {
    const v = parseFloat(input.value);
    if (Number.isFinite(v)) onValue(v);
    else input.value = String(value);
  });
  return input;
}

function selectOf(options: { value: string; label: string }[], value: string, onValue: (v: string) => void): HTMLSelectElement {
  const select = el('select', {});
  const known = options.some((o) => o.value === value);
  if (!known && value) select.append(el('option', { value, text: `${value} (missing)` }));
  for (const o of options) select.append(el('option', { value: o.value, text: o.label }));
  select.value = value;
  select.addEventListener('change', () => onValue(select.value));
  return select;
}

export interface BehaviorOptions {
  /** The rule list of the selected object; edited in place. */
  rules: Rule[];
  /** Names of the project's variables. */
  variables: () => string[];
  /** The sounds of the project (id and name) for the "play sound" action. */
  sounds: () => { id: string; name: string }[];
  /** The objects of the level (id and name): what "move" / "remove" / "play animation" can act on. */
  objects: () => { id: string; name: string }[];
  /** The levels of the project (id and name), for "go to level". */
  levels: () => { id: string; name: string }[];
  /** Animation names of the model of an object ('' = the object this behavior belongs to). */
  animations: (target: string) => string[];
  /** Something changed (the object is saved and re-shown). */
  onChange: () => void;
  /** Replace the rules by a ready-made behavior. */
  applyPreset: (kind: PresetKind) => void;
  newId: () => string;
}

/** "When … if … then …" rules of one object, as small cards. */
export function buildBehaviorEditor(opts: BehaviorOptions): HTMLElement {
  const root = el('div', { class: 'behavior' });

  const render = () => {
    clear(root);
    root.append(el('div', { class: 'form-section', text: 'Behavior' }));

    const preset = el('select', { title: 'Replace the rules of this object with a ready-made behavior' });
    preset.append(el('option', { value: '', text: 'Make this a…' }));
    for (const p of PRESETS) {
      // some game objects work by what they are (water) and have no rules to give
      if (presetRules(p.kind, opts.newId).length > 0) preset.append(el('option', { value: p.kind, text: `${p.label}: ${p.hint}` }));
    }
    preset.addEventListener('change', () => {
      const kind = preset.value as PresetKind | '';
      preset.value = '';
      if (kind) opts.applyPreset(kind);
    });
    root.append(el('div', { class: 'button-stack' }, preset));

    if (opts.rules.length === 0) {
      root.append(
        el('div', {
          class: 'empty muted',
          text: 'No rules: this object does nothing. Pick a ready-made behavior above, or add a rule.',
        }),
      );
    }

    opts.rules.forEach((rule, index) => root.append(ruleCard(rule, index)));

    root.append(
      el(
        'div',
        { class: 'button-stack' },
        el('button', {
          class: 'btn',
          text: '+ Rule',
          onclick: () => {
            opts.rules.push({ id: opts.newId(), event: 'touch', conditions: [], actions: [] });
            opts.onChange();
            render();
          },
        }),
      ),
    );
  };

  const variableOptions = () => opts.variables().map((n) => ({ value: n, label: n }));

  /** Which object an action acts on: the one the rule is on, or any object of the level. */
  const targetSelect = (value: string, onValue: (v: string) => void) => {
    const select = selectOf([{ value: '', label: 'This object' }, ...opts.objects().map((o) => ({ value: o.id, label: o.name }))], value, onValue);
    select.classList.add('wide');
    return select;
  };

  function ruleCard(rule: Rule, index: number): HTMLElement {
    const card = el('div', { class: 'rule-card' });

    const event = selectOf(
      RULE_EVENTS.map((e) => ({ value: e.value, label: e.label })),
      rule.event,
      (v) => {
        rule.event = v as RuleEvent;
        if (rule.event === 'timer' && rule.seconds === undefined) rule.seconds = 5;
        opts.onChange();
        render();
      },
    );
    card.append(
      el(
        'div',
        { class: 'rule-head' },
        el('span', { class: 'rule-word', text: 'When' }),
        event,
        el('button', {
          class: 'icon-btn',
          text: '×',
          title: 'Delete this rule',
          onclick: () => {
            opts.rules.splice(index, 1);
            opts.onChange();
            render();
          },
        }),
      ),
    );

    if (rule.event === 'timer') {
      const repeat = el('input', { type: 'checkbox', checked: rule.repeat === true });
      repeat.addEventListener('change', () => {
        rule.repeat = repeat.checked;
        opts.onChange();
      });
      card.append(
        el(
          'div',
          { class: 'rule-row' },
          el('span', { class: 'muted', text: 'after' }),
          numberInput(rule.seconds ?? 5, (v) => {
            rule.seconds = Math.max(0.1, v);
            opts.onChange();
          }, 0.5, '60px'),
          el('span', { class: 'muted', text: 's' }),
          el('label', { class: 'inline-check', title: 'Fire again every time this many seconds pass' }, repeat, el('span', { text: 'repeat' })),
        ),
      );
    }

    // conditions
    const conds = el('div', { class: 'rule-block' }, el('span', { class: 'rule-word', text: 'If' }));
    if (rule.conditions.length === 0) conds.append(el('span', { class: 'muted', text: 'always' }));
    rule.conditions.forEach((c, ci) => conds.append(conditionRow(rule, c, ci)));
    conds.append(
      el('button', {
        class: 'btn small',
        text: '+ condition',
        onclick: () => {
          rule.conditions.push({ variable: opts.variables()[0] ?? '', op: '>=', value: 1 });
          opts.onChange();
          render();
        },
      }),
    );
    card.append(conds);

    // actions
    const acts = el('div', { class: 'rule-block' }, el('span', { class: 'rule-word', text: 'Then' }));
    acts.append(actionBlock(rule.actions, false));
    card.append(acts);
    return card;
  }

  function conditionRow(rule: Rule, c: Condition, ci: number): HTMLElement {
    return el(
      'div',
      { class: 'rule-row' },
      selectOf(variableOptions(), c.variable, (v) => {
        c.variable = v;
        opts.onChange();
      }),
      selectOf(
        COMPARE_OPS.map((o) => ({ value: o, label: o })),
        c.op,
        (v) => {
          c.op = v as CompareOp;
          opts.onChange();
        },
      ),
      numberInput(c.value, (v) => {
        c.value = v;
        opts.onChange();
      }),
      el('button', {
        class: 'icon-btn',
        text: '×',
        title: 'Remove this condition',
        onclick: () => {
          rule.conditions.splice(ci, 1);
          opts.onChange();
          render();
        },
      }),
    );
  }

  /** A list of action rows with the "+ action" picker. `nested`: the actions of an answer (no questions inside). */
  function actionBlock(list: Action[], nested: boolean): HTMLElement {
    const wrap = el('div', { class: 'action-block' });
    if (list.length === 0) wrap.append(el('span', { class: 'muted', text: 'nothing yet' }));
    list.forEach((a, ai) => wrap.append(actionRow(list, a, ai, nested)));
    const add = el('select', { class: 'small', title: 'Add an action' });
    add.append(el('option', { value: '', text: '+ action…' }));
    for (const t of ACTION_TYPES) if (!(nested && t === 'choice')) add.append(el('option', { value: t, text: ACTION_LABELS[t] }));
    add.addEventListener('change', () => {
      const t = add.value as ActionType | '';
      if (!t) return;
      list.push(defaultAction(t, opts.variables()[0] ?? '', opts.sounds()[0]?.id ?? ''));
      opts.onChange();
      render();
    });
    wrap.append(add);
    return wrap;
  }

  /** What a character sounds like while the words appear: the voice, how high, and how fast the letters come. */
  function voiceRow(a: Extract<Action, { type: 'dialogue' | 'choice' }>): HTMLElement {
    const own = opts.sounds().filter((s) => !TALK_VOICES.includes(s.id));
    const voices = [
      { value: '', label: 'Voice: blip' },
      ...TALK_VOICES.filter((id) => id !== SOUND_IDS.talk).map((id) => ({ value: id, label: builtInSound(id)?.name ?? id })),
      ...own.map((s) => ({ value: s.id, label: s.name })),
      { value: SILENT_VOICE, label: 'Silent' },
    ];
    const voice = selectOf(voices, a.voice ?? '', (v) => {
      if (v) a.voice = v;
      else delete a.voice;
      opts.onChange();
    });
    voice.title = 'The sound that plays while the words appear (add your own in the Audio tab)';
    voice.classList.add('wide');
    const speed = numberInput(a.speed ?? DEFAULT_TEXT_SPEED, (v) => {
      const next = Math.min(MAX_TEXT_SPEED, Math.max(0, Math.round(v)));
      if (next === DEFAULT_TEXT_SPEED) delete a.speed;
      else a.speed = next;
      opts.onChange();
    }, 5, '52px');
    speed.title = 'Letters per second. 0 shows the whole line at once.';
    const pitch = numberInput(a.pitch ?? 1, (v) => {
      const next = Math.min(MAX_VOICE_PITCH, Math.max(MIN_VOICE_PITCH, v));
      if (next === 1) delete a.pitch;
      else a.pitch = next;
      opts.onChange();
    }, 0.1, '52px');
    pitch.title = 'How high the voice is: 1 as the sound was made, 0.5 an octave lower, 2 an octave higher';
    return el(
      'div',
      { class: 'rule-row' },
      voice,
      el('span', { class: 'muted', text: 'pitch' }),
      pitch,
      el('span', { class: 'muted', text: 'speed' }),
      speed,
      el('span', { class: 'muted', text: 'letters/s' }),
    );
  }

  function actionRow(list: Action[], a: Action, ai: number, nested: boolean): HTMLElement {
    const row = el('div', { class: 'rule-row' });
    const type = selectOf(
      ACTION_TYPES.filter((t) => !(nested && t === 'choice')).map((t) => ({ value: t, label: ACTION_LABELS[t] })),
      a.type,
      (v) => {
        list[ai] = defaultAction(v as ActionType, opts.variables()[0] ?? '', opts.sounds()[0]?.id ?? '');
        opts.onChange();
        render();
      },
    );
    type.classList.add('wide');
    row.append(type);
    if (a.type === 'set' || a.type === 'add') {
      row.append(
        selectOf(variableOptions(), a.variable, (v) => {
          a.variable = v;
          opts.onChange();
        }),
        numberInput(a.value, (v) => {
          a.value = v;
          opts.onChange();
        }),
      );
    } else if (a.type === 'sound') {
      row.append(
        selectOf(
          opts.sounds().map((s) => ({ value: s.id, label: s.name })),
          a.sound,
          (v) => {
            a.sound = v;
            opts.onChange();
          },
        ),
      );
    } else if (a.type === 'destroy' || a.type === 'move' || a.type === 'patrol' || a.type === 'animate') {
      row.append(targetSelect(a.target ?? '', (v) => {
        a.target = v;
        if (a.type === 'animate') a.animation = '';
        opts.onChange();
        render();
      }));
      if (a.type === 'move' || a.type === 'patrol') {
        const offset = a.offset;
        const minSeconds = a.type === 'patrol' ? 0.2 : 0;
        row.append(
          el('span', { class: 'muted', text: 'by' }),
          ...(['x', 'y', 'z'] as const).map((_, i) =>
            numberInput(offset[i]!, (v) => {
              offset[i] = v;
              opts.onChange();
            }, 0.5, '52px'),
          ),
          el('span', { class: 'muted', text: a.type === 'patrol' ? 'm, each way in' : 'm in' }),
          numberInput(a.seconds, (v) => {
            a.seconds = Math.max(minSeconds, v);
            opts.onChange();
          }, 0.5, '52px'),
          el('span', { class: 'muted', text: 's' }),
        );
      } else if (a.type === 'animate') {
        row.append(
          selectOf(
            [{ value: '', label: 'Stand still' }, ...opts.animations(a.target).map((n) => ({ value: n, label: n }))],
            a.animation,
            (v) => {
              a.animation = v;
              opts.onChange();
            },
          ),
        );
      }
    } else if (a.type === 'level') {
      row.append(
        (() => {
          const select = selectOf([{ value: '', label: 'The next level' }, ...opts.levels().map((l) => ({ value: l.id, label: l.name }))], a.level, (v) => {
            a.level = v;
            opts.onChange();
          });
          select.classList.add('wide');
          return select;
        })(),
      );
    } else if (a.type === 'end') {
      const title = el('input', { type: 'text', value: a.title, placeholder: 'Title' });
      title.addEventListener('input', () => {
        a.title = title.value;
        opts.onChange();
      });
      const text = el('input', { type: 'text', value: a.text, placeholder: 'Text, e.g. Coins: {coins}', title: '{name} shows the value of a variable' });
      text.addEventListener('input', () => {
        a.text = text.value;
        opts.onChange();
      });
      row.append(title, text);
    } else if (a.type === 'chase') {
      row.append(
        targetSelect(a.target, (v) => {
          a.target = v;
          opts.onChange();
        }),
        el('span', { class: 'muted', text: 'at' }),
        numberInput(a.speed, (v) => {
          a.speed = Math.min(20, Math.max(0.1, v));
          opts.onChange();
        }, 0.5, '52px'),
        el('span', { class: 'muted', text: 'm/s when within' }),
        numberInput(a.range, (v) => {
          a.range = Math.min(80, Math.max(1, v));
          opts.onChange();
        }, 1, '52px'),
        el('span', { class: 'muted', text: 'm' }),
      );
    } else if (a.type === 'hurt') {
      row.append(
        numberInput(a.amount, (v) => {
          a.amount = Math.max(0, v);
          opts.onChange();
        }, 1, '52px'),
        el('span', { class: 'muted', text: 'off' }),
        selectOf(variableOptions(), a.variable, (v) => {
          a.variable = v;
          opts.onChange();
        }),
        el('span', { class: 'muted', text: 'knock back' }),
        numberInput(a.knockback, (v) => {
          a.knockback = Math.min(30, Math.max(0, v));
          opts.onChange();
        }, 1, '52px'),
      );
    } else if (a.type === 'bounce') {
      row.append(
        el('span', { class: 'muted', text: 'speed' }),
        numberInput(a.strength, (v) => {
          a.strength = Math.min(30, Math.max(2, v));
          opts.onChange();
        }, 1, '52px'),
        el('span', { class: 'muted', text: 'm/s up' }),
      );
    } else if (a.type === 'dialogue') {
      const speaker = el('input', { type: 'text', value: a.speaker, placeholder: 'Who is talking' });
      speaker.addEventListener('input', () => {
        a.speaker = speaker.value;
        opts.onChange();
      });
      const lines = el('textarea', { rows: '3', placeholder: 'One line per row. {coins} shows a variable.' });
      lines.value = a.lines.join('\n');
      lines.addEventListener('input', () => {
        const parts = lines.value.split('\n').filter((l) => l.trim().length > 0);
        a.lines = parts.length > 0 ? parts : ['...'];
        opts.onChange();
      });
      row.append(speaker, lines, voiceRow(a));
    } else if (a.type === 'choice') {
      const speaker = el('input', { type: 'text', value: a.speaker ?? '', placeholder: 'Who is asking (optional)' });
      speaker.addEventListener('input', () => {
        if (speaker.value) a.speaker = speaker.value;
        else delete a.speaker;
        opts.onChange();
      });
      const question = el('input', { type: 'text', value: a.question, placeholder: 'The question' });
      question.addEventListener('input', () => {
        a.question = question.value;
        opts.onChange();
      });
      row.append(speaker, question, voiceRow(a));
      a.options.forEach((o, oi) => {
        const label = el('input', { type: 'text', value: o.label, placeholder: `Answer ${oi + 1}` });
        label.addEventListener('input', () => {
          o.label = label.value;
          opts.onChange();
        });
        row.append(
          el(
            'div',
            { class: 'choice-option' },
            el(
              'div',
              { class: 'rule-row' },
              el('span', { class: 'muted', text: `${oi + 1}.` }),
              label,
              el('button', {
                class: 'icon-btn',
                text: '×',
                title: 'Remove this answer',
                onclick: () => {
                  if (a.options.length > 1) a.options.splice(oi, 1);
                  opts.onChange();
                  render();
                },
              }),
            ),
            el('div', { class: 'muted small', text: 'then:' }),
            actionBlock(o.actions, true),
          ),
        );
      });
      if (a.options.length < 4) {
        row.append(
          el('button', {
            class: 'btn small',
            text: '+ answer',
            onclick: () => {
              a.options.push({ label: `Answer ${a.options.length + 1}`, actions: [] });
              opts.onChange();
              render();
            },
          }),
        );
      }
    } else if (a.type === 'message') {
      const text = el('input', { type: 'text', value: a.text, placeholder: 'Message, e.g. {coins} coins', title: '{name} shows the value of a variable' });
      text.addEventListener('input', () => {
        a.text = text.value;
        opts.onChange();
      });
      row.append(
        text,
        numberInput(a.seconds, (v) => {
          a.seconds = Math.max(0.2, v);
          opts.onChange();
        }, 0.5, '52px'),
        el('span', { class: 'muted', text: 's' }),
      );
    }
    row.append(
      el('button', {
        class: 'icon-btn',
        text: '×',
        title: 'Remove this action',
        onclick: () => {
          list.splice(ai, 1);
          opts.onChange();
          render();
        },
      }),
    );
    return row;
  }

  render();
  return root;
}

function defaultAction(type: ActionType, variable: string, sound = ''): Action {
  switch (type) {
    case 'set':
      return { type, variable, value: 0 };
    case 'add':
      return { type, variable, value: 1 };
    case 'message':
      return { type, text: 'Hello!', seconds: 2 };
    case 'sound':
      return { type, sound };
    case 'move':
      return { type, target: '', offset: [0, 2, 0], seconds: 1 };
    case 'patrol':
      return { type, target: '', offset: [4, 0, 0], seconds: 3 };
    case 'animate':
      return { type, target: '', animation: '' };
    case 'end':
      return { type, title: 'You win!', text: '' };
    case 'level':
      return { type, level: '' };
    case 'chase':
      return { type, target: '', speed: 2.5, range: 10 };
    case 'hurt':
      return { type, amount: 1, variable: variable || 'health', knockback: 6 };
    case 'bounce':
      return { type, strength: 10 };
    case 'dialogue':
      return { type, speaker: 'Villager', lines: ['Hello there!'] };
    case 'choice':
      return {
        type,
        question: 'What do you say?',
        options: [
          { label: 'Hello!', actions: [] },
          { label: 'Goodbye.', actions: [] },
        ],
      };
    case 'destroy':
    case 'respawn':
    case 'checkpoint':
    case 'restart':
      return { type };
  }
}

// ---------------------------------------------------------------- the variables list

export interface VariablesOptions {
  variables: () => Variable[];
  add: () => void;
  remove: (id: string) => void;
  rename: (id: string, name: string) => boolean;
  /** A value other than the name changed. */
  changed: () => void;
}

/** The project's variables: name, start value, limits, and how they look on the screen. */
export function buildVariablesPanel(opts: VariablesOptions): HTMLElement {
  const root = el('div', { class: 'variables' });
  const vars = opts.variables();

  root.append(
    el('div', {
      class: 'empty muted',
      text: 'Numbers the game keeps track of. Rules change them (a coin adds to “coins”) and can test them (a door wants “keys” ≥ 1).',
    }),
  );
  if (vars.length === 0) root.append(el('div', { class: 'empty muted', text: 'No variables yet.' }));

  for (const v of vars) {
    const name = el('input', { type: 'text', value: v.name });
    name.addEventListener('change', () => {
      if (!opts.rename(v.id, name.value.trim())) name.value = v.name;
    });
    const limit = (value: number | null, set: (n: number | null) => void) => {
      const input = el('input', { type: 'number', step: '1', value: value === null ? '' : String(value), placeholder: 'none' });
      input.style.width = '64px';
      input.addEventListener('change', () => {
        const n = parseFloat(input.value);
        set(Number.isFinite(n) ? n : null);
        opts.changed();
      });
      return input;
    };
    const row = (label: string, ...controls: HTMLElement[]) =>
      el('div', { class: 'form-row' }, el('span', { class: 'form-label', text: label }), el('span', { class: 'form-control' }, ...controls));
    const hud = el('input', { type: 'checkbox', checked: v.hud });
    hud.addEventListener('change', () => {
      v.hud = hud.checked;
      opts.changed();
    });
    const icon = el('input', { type: 'text', value: v.icon, placeholder: '🪙' });
    icon.style.width = '48px';
    icon.addEventListener('input', () => {
      v.icon = icon.value;
      opts.changed();
    });
    const label = el('input', { type: 'text', value: v.label, placeholder: v.name });
    label.addEventListener('input', () => {
      v.label = label.value;
      opts.changed();
    });

    root.append(
      el(
        'div',
        { class: 'var-card' },
        row('Name', name),
        row('Starts at', numberInput(v.initial, (n) => {
          v.initial = n;
          opts.changed();
        })),
        row('Min / Max', limit(v.min, (n) => (v.min = n)), limit(v.max, (n) => (v.max = n))),
        row('On screen', hud),
        row('Icon', icon),
        row('Label', label),
        el('button', { class: 'btn danger small', text: 'Delete', onclick: () => opts.remove(v.id) }),
      ),
    );
  }

  root.append(el('div', { class: 'button-stack' }, el('button', { class: 'btn', text: '+ Variable', onclick: () => opts.add() })));
  return root;
}
